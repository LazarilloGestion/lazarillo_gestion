import { prisma } from "@/lib/prisma";
import { consultaRender, identRender, renderConfigurado } from "./db";
import { detectarSemanas, dias, type SemanaPrecios } from "@/lib/dashboard/aumentos";

// Detección de aumentos de precios de la carta desde el informe 12 de Render (Diego 30/10/2026).
// Corre después de la lectura diaria (cron) y desde el botón ↻ de la Canasta.

const tabla12 = (esquema: string, anio: number) =>
  `${identRender(esquema)}.${identRender(`i12_ventas_por_articulo_ranking_detallado_por_dia_${anio}`)}`;

async function semanas(esquema: string, pdv: string, anio: number): Promise<SemanaPrecios[]> {
  // Precio semanal de cada artículo (≥5 unidades) contra la semana anterior; saltos de ×1,6 o ÷1,4 son
  // cambios de presentación, no aumentos.
  const filas = await consultaRender<{ semana: string; n: string; suben: string; variacion: string }>(`
    WITH s AS (
      SELECT date_trunc('week', fecha)::date AS w, codigo, SUM(importe) AS imp, SUM(unidades) AS u
      FROM ${tabla12(esquema, anio)} WHERE pdv = $1 AND unidades > 0 AND importe > 0 GROUP BY 1, 2),
    p AS (SELECT w, codigo, imp, imp / u AS pr FROM s WHERE u >= 5),
    par AS (SELECT a.w, a.pr AS pa, b.pr AS pb, b.imp AS ib FROM p a JOIN p b ON b.codigo = a.codigo AND b.w = a.w - 7
            WHERE a.pr / b.pr BETWEEN 0.7 AND 1.6)
    SELECT w::text AS semana, COUNT(*) AS n, (COUNT(*) FILTER (WHERE pa / pb > 1.03))::float8 / COUNT(*) AS suben,
           exp(SUM(ib * ln(pa / pb)) / SUM(ib)) - 1 AS variacion
    FROM par GROUP BY w`, [pdv]).catch(() => []); // el año puede no tener tabla todavía
  return filas.map((f) => ({ semana: f.semana, n: Number(f.n), suben: Number(f.suben), variacion: Number(f.variacion) }));
}

/** Cuánto subió la carta: precio de cada artículo 2 semanas antes vs las semanas 2 y 3 después, ponderado. */
async function pctAumento(esquema: string, pdv: string, fecha: string): Promise<number | null> {
  // Tabla del año del aumento (uno en las primeras/últimas 3 semanas del año se mide con lo que haya).
  const t = tabla12(esquema, Number(fecha.slice(0, 4)));
  const filas = await consultaRender<{ pct: string | null }>(`
    WITH x AS (
      SELECT codigo,
        SUM(importe) FILTER (WHERE fecha >= $2::date - 14 AND fecha < $2::date) AS ia,
        SUM(unidades) FILTER (WHERE fecha >= $2::date - 14 AND fecha < $2::date) AS ua,
        SUM(importe) FILTER (WHERE fecha >= $2::date + 7 AND fecha < $2::date + 21) AS id,
        SUM(unidades) FILTER (WHERE fecha >= $2::date + 7 AND fecha < $2::date + 21) AS ud
      FROM ${t} WHERE pdv = $1 AND fecha >= $2::date - 14 AND fecha < $2::date + 21 AND unidades > 0 AND importe > 0
      GROUP BY 1),
    r AS (SELECT ia, (id / ud) / (ia / ua) AS rel FROM x WHERE ua >= 4 AND ud >= 4 AND (id / ud) / (ia / ua) BETWEEN 0.7 AND 1.6)
    SELECT CASE WHEN COUNT(*) >= 10 THEN exp(SUM(ia * ln(rel)) / SUM(ia)) - 1 END AS pct FROM r`, [pdv, fecha]).catch(() => []);
  const v = filas[0]?.pct;
  return v == null ? null : Number(v);
}

export interface ResultadoAumentos { puntoDeVentaId: number; detectados: string[]; nuevos: string[] }

export async function detectarAumentos(soloPdv?: number): Promise<ResultadoAumentos[]> {
  if (!renderConfigurado()) return [];
  const origenes = await prisma.renderOrigen.findMany({ where: { activo: true, ...(soloPdv ? { puntoDeVentaId: soloPdv } : {}) } });
  const hoy = new Date().toISOString().slice(0, 10);
  const anio = Number(hoy.slice(0, 4));
  const out: ResultadoAumentos[] = [];
  for (const o of origenes) {
    const sem = [...await semanas(o.esquema, o.pdv, anio - 1), ...await semanas(o.esquema, o.pdv, anio)];
    const fechas = detectarSemanas(sem);
    const nuevos: string[] = [];
    for (const f of fechas) {
      const pct = await pctAumento(o.esquema, o.pdv, f);
      const provisorio = dias(f, hoy) < 21; // todavía no hay 3 semanas después del aumento
      const cerca = await prisma.$queryRaw<{ fecha: string; origen: string; descartado: boolean; pct: number | null }[]>`
        SELECT fecha::text AS fecha, origen, descartado, pct::float8 AS pct FROM aumentos_precio
        WHERE "puntoDeVentaId" = ${o.puntoDeVentaId} AND ABS(fecha - ${f}::date) <= 7`;
      if (cerca.some((c) => c.descartado)) continue; // Diego lo sacó: no se vuelve a agregar
      if (cerca.length) {
        // Ya estaba (detectado o a mano): se completa/actualiza el %, sin pisar uno cargado a mano.
        await prisma.$executeRaw`UPDATE aumentos_precio SET pct = ${pct}, provisorio = ${provisorio}
          WHERE "puntoDeVentaId" = ${o.puntoDeVentaId} AND fecha = ${cerca[0].fecha}::date AND (origen = 'detectado' OR pct IS NULL)`;
      } else {
        await prisma.$executeRaw`INSERT INTO aumentos_precio ("puntoDeVentaId", fecha, origen, pct, provisorio)
          VALUES (${o.puntoDeVentaId}, ${f}::date, 'detectado', ${pct}, ${provisorio}) ON CONFLICT DO NOTHING`;
        nuevos.push(f);
      }
    }
    out.push({ puntoDeVentaId: o.puntoDeVentaId, detectados: fechas, nuevos });
  }
  return out;
}
