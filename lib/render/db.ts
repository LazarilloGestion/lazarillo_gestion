import { Client, types } from "pg";
import { tipoDeOid, type TipoColumna } from "./filas";

// Conexión de SOLO LECTURA a la base de Render donde el kit sube los informes
// todos los días (esquemas container / comercio / migago). La URL vive en la
// variable RENDER_DATABASE_URL de Vercel (nunca en el código).
export function renderConfigurado(): boolean {
  return !!process.env.RENDER_DATABASE_URL;
}

// Fechas, numeric y bigint llegan como texto: filaDeRender los convierte igual
// que los lee el import del Excel (serial de Excel / número).
const COMO_TEXTO = new Set([20, 1082, 1114, 1184, 1700]);
const parsers = {
  getTypeParser: ((oid: number, format?: "text" | "binary") =>
    COMO_TEXTO.has(oid) ? (v: string) => v : types.getTypeParser(oid, format)) as typeof types.getTypeParser,
};

const IDENT = /^[a-z0-9_]+$/;
function ident(nombre: string): string {
  if (!IDENT.test(nombre)) throw new Error(`Nombre inválido en Render: ${nombre}`);
  return `"${nombre}"`;
}

async function conRender<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const url = process.env.RENDER_DATABASE_URL;
  if (!url) throw new Error("Falta configurar RENDER_DATABASE_URL en Vercel.");
  const c = new Client({
    connectionString: url.replace(/[?&]sslmode=[^&]*/g, ""),
    ssl: { rejectUnauthorized: false },
    types: parsers,
    statement_timeout: 60_000,
    connectionTimeoutMillis: 15_000,
  });
  await c.connect();
  try {
    await c.query("SET default_transaction_read_only = on");
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}

/** Consulta de solo lectura con parámetros (los nombres de tabla se validan con identRender). */
export async function consultaRender<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return conRender(async (c) => (await c.query(sql, params)).rows as T[]);
}
export function identRender(nombre: string): string {
  return ident(nombre);
}

// Así anota el kit en _cargas las tablas de maestros (una por organización, sin pdv).
export const PDV_MAESTROS = "(maestros)";

export type CargaRender = { pdv: string; tabla: string; filas: number; cargado: string; tieneFila: boolean };

// Última carga del kit por PDV y tabla (tabla _cargas de cada esquema), y si la
// tabla ya trae la columna `fila` (orden de las filas del informe).
export async function leerCargas(esquema: string, pdvs: string[]): Promise<CargaRender[]> {
  return conRender(async (c) => {
    const { rows } = await c.query<{ pdv: string; tabla: string; filas: string; cargado: string }>(
      `SELECT DISTINCT ON (pdv, tabla) pdv, tabla, filas,
              to_char(cargado AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS cargado
         FROM ${ident(esquema)}._cargas WHERE pdv = ANY($1) ORDER BY pdv, tabla, cargado DESC`,
      [pdvs]
    );
    const conFila = await c.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'fila'`,
      [esquema]
    );
    const tablasConFila = new Set(conFila.rows.map((r) => r.table_name));
    // La columna es de la tabla, pero cada PDV la llena recién cuando SU PC corre
    // con el kit nuevo (Canchas Ramos a veces tarda en tomarlo): hasta que todas
    // sus filas tengan número, ese PDV sigue sin orden.
    const out: CargaRender[] = [];
    for (const r of rows) {
      let tieneFila = false;
      if (tablasConFila.has(r.tabla)) {
        const q = await c.query<{ sin: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM ${ident(esquema)}.${ident(r.tabla)} WHERE pdv = $1 AND fila IS NULL) AS sin`,
          [r.pdv]
        );
        tieneFila = !q.rows[0]?.sin;
      }
      out.push({ pdv: r.pdv, tabla: r.tabla, filas: Number(r.filas), cargado: r.cargado, tieneFila });
    }
    return out;
  });
}

// Huella del CONTENIDO de esa tabla para ese PDV: el kit recarga todo cada día,
// así que la fecha de carga cambia aunque los datos sean los mismos.
export async function huellaTabla(esquema: string, tabla: string, pdv: string): Promise<string> {
  return conRender(async (c) => {
    const { rows } = await c.query<{ n: string; h: string | null }>(
      `SELECT count(*) AS n, md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))) AS h
         FROM ${ident(esquema)}.${ident(tabla)} t${pdv === PDV_MAESTROS ? "" : " WHERE pdv = $1"}`,
      pdv === PDV_MAESTROS ? [] : [pdv]
    );
    return `${rows[0]?.n ?? 0}|${rows[0]?.h ?? ""}`;
  });
}

export async function leerTabla(
  esquema: string,
  tabla: string,
  pdv: string,
  ordenarPorFila: boolean
): Promise<{ filas: Record<string, unknown>[]; tipos: Record<string, TipoColumna> }> {
  return conRender(async (c) => {
    const r = await c.query(
      `SELECT * FROM ${ident(esquema)}.${ident(tabla)}${pdv === PDV_MAESTROS ? "" : " WHERE pdv = $1"}${ordenarPorFila ? " ORDER BY fila" : ""}`,
      pdv === PDV_MAESTROS ? [] : [pdv]
    );
    const tipos: Record<string, TipoColumna> = {};
    for (const f of r.fields) tipos[f.name] = tipoDeOid(f.dataTypeID);
    return { filas: r.rows, tipos };
  });
}

export type ConceptoMaestro = { codigo: number; nombre: string; tipo: string | null; codRubro: number | null; rubro: string | null; imputacion?: string | null };

// Maestro 17 (conceptos de caja) tal como lo sube el kit cada día desde MaxiRest.
export async function leerConceptos(esquema: string): Promise<ConceptoMaestro[]> {
  return conRender(async (c) => {
    const { rows } = await c.query<{ codigo: string; nombre: string; tipo: string | null; cod_rga: string | null; rubro: string | null }>(
      `SELECT codigo, nombre, tipo, cod_rga, rubro FROM ${ident(esquema)}.m17_conceptos_de_caja ORDER BY codigo`
    );
    return rows.map((r) => ({
      codigo: Number(r.codigo),
      nombre: (r.nombre ?? "").trim(),
      tipo: r.tipo,
      codRubro: r.cod_rga != null ? Number(r.cod_rga) : null,
      rubro: r.rubro?.trim() ?? null,
    }));
  });
}

// Maestro de insumos de MaxiRest (m0): cada insumo con su rubro y el concepto de
// caja de ese rubro (en MaxiRest cada rubro de insumo tiene uno; 0 = sin concepto).
/** Envase de compra de un insumo (X8, X6, Pack…) y cuántas unidades base trae. */
export type Envase = { envase: string; factor: number };
export type InsumoMaestro = { codigo: string; nombre: string; medida: string | null; rubro: string | null; codCga: string | null; precio: number | null; discontinuado: boolean; envases: Envase[] };

export async function leerInsumos(esquema: string): Promise<InsumoMaestro[]> {
  return conRender(async (c) => {
    type Fila = { codigo: string | null; nombre: string | null; unidad_med: string | null; rubro: string | null; cod_cga: string | null; precio: string | null; discontinuado: string | null;
      envase1: string | null; neto1: string | null; envase2: string | null; neto2: string | null; envase3: string | null; neto3: string | null };
    const { rows } = await c.query<Fila>(
      `SELECT codigo, nombre, unidad_med, rubro, cod_cga, precio, discontinuado, envase1, neto1, envase2, neto2, envase3, neto3
       FROM ${ident(esquema)}.m0_listado_de_insumos_con_discontinuados`
    );
    return rows.flatMap((r) => {
      const cod = Number(r.codigo);
      const nombre = (r.nombre ?? "").trim();
      if (!Number.isFinite(cod) || !nombre) return [];
      const cga = Number(r.cod_cga);
      const precio = Number(r.precio);
      const disc = String(r.discontinuado ?? "").trim().toUpperCase();
      // En MaxiRest la compra se carga en el envase (X8, Pack…) y el 25 trae esa medida con el
      // precio POR ENVASE (igual que el informe original): el factor está en el maestro.
      const envases: Envase[] = ([[r.envase1, r.neto1], [r.envase2, r.neto2], [r.envase3, r.neto3]] as const).flatMap(([e, n]) => {
        const envase = (e ?? "").trim();
        const factor = Number(n);
        return envase && Number.isFinite(factor) && factor > 0 ? [{ envase, factor }] : [];
      });
      return [{
        codigo: String(cod),
        nombre,
        medida: r.unidad_med?.trim() || null,
        rubro: r.rubro?.trim() || null,
        codCga: Number.isFinite(cga) && cga > 0 ? String(cga) : null,
        precio: Number.isFinite(precio) && precio > 0 ? precio : null,
        discontinuado: disc === "S" || disc === "SI" || disc === "1" || disc === "TRUE",
        envases,
      }];
    });
  });
}
