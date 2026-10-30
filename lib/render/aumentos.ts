import { prisma } from "@/lib/prisma";
import { consultaRender, identRender, renderConfigurado } from "./db";
import { detectarSemanas, dias, PATRON_BEBIDAS, PATRON_PROMOS, type Grupo, type VentanaGrupo } from "@/lib/dashboard/aumentos";

// Detección de aumentos de precios de la carta desde el informe 12 de Render (Diego 30/10/2026).
// Corre después de la lectura diaria (cron) y desde el botón "detectar" de la Canasta.
// Mira cada agrupación (comidas / bebidas / promos) por separado: a veces sube solo una.

const T12 = "i12_ventas_por_articulo_ranking_detallado_por_dia_";

/** Ventas por artículo y día de los años pedidos que existan en Render (UNION de las tablas anuales). */
async function fuente12(esquema: string, anios: number[]): Promise<string | null> {
  const existen = await consultaRender<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2)`,
    [esquema, anios.map((a) => `${T12}${a}`)]);
  if (!existen.length) return null;
  return `(${existen.map((e) => `SELECT codigo, fecha::date AS f, importe, unidades, pdv FROM ${identRender(esquema)}.${identRender(e.t)}`).join(" UNION ALL ")})`;
}

const grupoSql = (rubro: string) =>
  `CASE WHEN ${rubro} ~* '${PATRON_PROMOS}' THEN 'promos' WHEN ${rubro} ~* '${PATRON_BEBIDAS}' THEN 'bebidas' ELSE 'comidas' END`;

/** Por semana: fracción de artículos (≥5 u.) que subieron más de 3% contra la semana anterior. */
async function subenSemanal(fuente: string, pdv: string): Promise<Map<string, number>> {
  const filas = await consultaRender<{ semana: string; suben: string }>(`
    WITH s AS (SELECT date_trunc('week', f)::date AS w, codigo, SUM(importe) / SUM(unidades) AS pr, SUM(unidades) AS u
               FROM ${fuente} t WHERE pdv = $1 AND unidades > 0 AND importe > 0 GROUP BY 1, 2)
    SELECT a.w::text AS semana, (COUNT(*) FILTER (WHERE a.pr / b.pr > 1.03))::float8 / COUNT(*) AS suben
    FROM s a JOIN s b ON b.codigo = a.codigo AND b.w = a.w - 7
    WHERE a.u >= 5 AND b.u >= 5 AND a.pr / b.pr BETWEEN 0.7 AND 1.6 GROUP BY a.w`, [pdv]);
  return new Map(filas.map((f) => [f.semana, Number(f.suben)]));
}

// Precio de cada artículo en las 2 semanas antes de la fecha vs las semanas 2 y 3 después (la semana del
// aumento queda afuera porque mezcla precios viejos y nuevos), ponderado por lo vendido antes.
const VENTANA = `
  SUM(t.importe) FILTER (WHERE t.f >= x.w - 14 AND t.f < x.w) AS ia, SUM(t.unidades) FILTER (WHERE t.f >= x.w - 14 AND t.f < x.w) AS ua,
  SUM(t.importe) FILTER (WHERE t.f >= x.w + 7 AND t.f < x.w + 21) AS id, SUM(t.unidades) FILTER (WHERE t.f >= x.w + 7 AND t.f < x.w + 21) AS ud`;
const RUBROS = (esquema: string) =>
  `(SELECT DISTINCT ON (codigo) codigo, rubro FROM ${identRender(esquema)}.${identRender("m6_listado_de_articulos")} ORDER BY codigo)`;

async function ventanas(fuente: string, esquema: string, pdv: string): Promise<VentanaGrupo[]> {
  const filas = await consultaRender<{ semana: string; grupo: Grupo; n: string; suben: string; variacion: string }>(`
    WITH t AS (SELECT codigo, f, importe, unidades FROM ${fuente} t WHERE pdv = $1 AND unidades > 0 AND importe > 0),
    x AS (SELECT DISTINCT date_trunc('week', f)::date AS w FROM t),
    a AS (SELECT x.w, t.codigo, ${VENTANA} FROM x JOIN t ON t.f >= x.w - 14 AND t.f < x.w + 21 GROUP BY 1, 2),
    r AS (SELECT a.w, ${grupoSql("m.rubro")} AS g, ia, (id / ud) / (ia / ua) AS rel
          FROM a LEFT JOIN ${RUBROS(esquema)} m ON m.codigo = a.codigo
          WHERE ua >= 4 AND ud >= 4 AND (id / ud) / (ia / ua) BETWEEN 0.7 AND 1.6)
    SELECT w::text AS semana, g AS grupo, COUNT(*) AS n, (COUNT(*) FILTER (WHERE rel > 1.03))::float8 / COUNT(*) AS suben,
           exp(SUM(ia * ln(rel)) / SUM(ia)) - 1 AS variacion
    FROM r GROUP BY 1, 2`, [pdv]);
  return filas.map((f) => ({ semana: f.semana, grupo: f.grupo, n: Number(f.n), suben: Number(f.suben), variacion: Number(f.variacion) }));
}

/** Cuánto subió la carta en esa fecha, en total y por agrupación. */
async function medirAumento(fuente: string, esquema: string, pdv: string, fecha: string): Promise<{ pct: number | null; detalle: Partial<Record<Grupo, number>> }> {
  const filas = await consultaRender<{ g: string; pct: string | null }>(`
    WITH x AS (SELECT $2::date AS w),
    a AS (SELECT t.codigo, ${VENTANA} FROM x JOIN ${fuente} t ON t.pdv = $1 AND t.unidades > 0 AND t.importe > 0
          AND t.f >= x.w - 14 AND t.f < x.w + 21 GROUP BY 1),
    r AS (SELECT ${grupoSql("m.rubro")} AS g, ia, (id / ud) / (ia / ua) AS rel
          FROM a LEFT JOIN ${RUBROS(esquema)} m ON m.codigo = a.codigo
          WHERE ua >= 4 AND ud >= 4 AND (id / ud) / (ia / ua) BETWEEN 0.7 AND 1.6)
    SELECT COALESCE(g, 'total') AS g, CASE WHEN COUNT(*) >= 5 THEN exp(SUM(ia * ln(rel)) / SUM(ia)) - 1 END AS pct
    FROM r GROUP BY ROLLUP (g)`, [pdv, fecha]);
  const detalle: Partial<Record<Grupo, number>> = {};
  let pct: number | null = null;
  for (const f of filas) {
    if (f.pct == null) continue;
    if (f.g === "total") pct = Number(f.pct); else detalle[f.g as Grupo] = Number(f.pct);
  }
  return { pct, detalle };
}

export interface ResultadoAumentos { puntoDeVentaId: number; detectados: string[]; nuevos: string[] }

export async function detectarAumentos(soloPdv?: number): Promise<ResultadoAumentos[]> {
  if (!renderConfigurado()) return [];
  const origenes = await prisma.renderOrigen.findMany({ where: { activo: true, ...(soloPdv ? { puntoDeVentaId: soloPdv } : {}) } });
  const hoy = new Date().toISOString().slice(0, 10);
  const anio = Number(hoy.slice(0, 4));
  const out: ResultadoAumentos[] = [];
  for (const o of origenes) {
    const fuente = await fuente12(o.esquema, [anio - 1, anio]);
    if (!fuente) { out.push({ puntoDeVentaId: o.puntoDeVentaId, detectados: [], nuevos: [] }); continue; }
    const fechas = detectarSemanas(await ventanas(fuente, o.esquema, o.pdv), await subenSemanal(fuente, o.pdv));
    const nuevos: string[] = [];
    for (const f of fechas) {
      const { pct, detalle } = await medirAumento(fuente, o.esquema, o.pdv, f);
      const provisorio = dias(f, hoy) < 21; // todavía no hay 3 semanas después del aumento
      const det = JSON.stringify(detalle);
      const cerca = await prisma.$queryRaw<{ fecha: string; descartado: boolean }[]>`
        SELECT fecha::text AS fecha, descartado FROM aumentos_precio
        WHERE "puntoDeVentaId" = ${o.puntoDeVentaId} AND ABS(fecha - ${f}::date) <= 7`;
      if (cerca.some((c) => c.descartado)) continue; // Diego lo sacó: no se vuelve a agregar
      if (cerca.length) {
        // Ya estaba (detectado o a mano): se completa/actualiza el %, sin pisar uno cargado a mano.
        await prisma.$executeRaw`UPDATE aumentos_precio SET pct = ${pct}, detalle = ${det}::jsonb, provisorio = ${provisorio}
          WHERE "puntoDeVentaId" = ${o.puntoDeVentaId} AND fecha = ${cerca[0].fecha}::date AND (origen = 'detectado' OR pct IS NULL)`;
      } else {
        await prisma.$executeRaw`INSERT INTO aumentos_precio ("puntoDeVentaId", fecha, origen, pct, detalle, provisorio)
          VALUES (${o.puntoDeVentaId}, ${f}::date, 'detectado', ${pct}, ${det}::jsonb, ${provisorio}) ON CONFLICT DO NOTHING`;
        nuevos.push(f);
      }
    }
    out.push({ puntoDeVentaId: o.puntoDeVentaId, detectados: fechas, nuevos });
  }
  return out;
}
