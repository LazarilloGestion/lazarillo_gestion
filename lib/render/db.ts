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
    return rows.map((r) => ({ pdv: r.pdv, tabla: r.tabla, filas: Number(r.filas), cargado: r.cargado, tieneFila: tablasConFila.has(r.tabla) }));
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
