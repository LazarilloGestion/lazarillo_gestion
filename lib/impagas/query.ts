import { Prisma } from "@prisma/client";
import { sinRubroVisibleSql } from "@/lib/dashboard/query-builders";

// Desde cuándo se cuentan impagas: antes de esa fecha el informe 80 no cubre
// los comprobantes (en Ramos el 14 de ene–ago 2025 numera las facturas como
// "F" y no cruzan con el 80) y todo aparecería impago. Por instancia: Comercio
// arranca en 2025-01-01 (IMPAGAS_DESDE en Vercel).
export const IMPAGAS_DESDE_DEFAULT = "2025-09-01";

export function impagasDesde(raw: string | undefined): string {
  const v = raw?.trim();
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : IMPAGAS_DESDE_DEFAULT;
}

export interface ImpagaSqlRow {
  comprobante: string;
  cod_pro: string;
  proveedor: string | null;
  proveedor_id: number | null;
  fecha: string;
  total: number;
  pagado: number;
  rubro_oculto: string | null;
  pago_automatico: boolean;
  forzada: boolean;
  conceptos: string | null;
  pagos: { fecha: string; importe: number; medio: string | null }[] | null;
}

// Un comprobante = (PDV, comprobante, código de proveedor): en el 14 una
// factura viene partida en varias filas (conceptos + percepciones).
// Fuera de la vista: filas sin comprobante (gastos varios sin número) y los
// números internos E/G que arma el kit para gastos varios — en MaxiRest un
// gasto vario se carga siempre con su pago.
// Rubro oculto: TODAS las líneas que no son percepción son de rubros apagados
// en "Rubros visibles en panel" (las percepciones no cuentan: Agronatural).
export function impagasSql(pdvId: number, desde: string): Prisma.Sql {
  const visible = Prisma.sql`(COALESCE(rc."visibleEnDashboard", ${sinRubroVisibleSql("visibleEnDashboard")}))`;
  const esPercepcion = Prisma.sql`(COALESCE(cc.nombre, c.concepto, '') ILIKE '%percep%')`;
  return Prisma.sql`
    WITH f AS (
      SELECT
        c.comprobante,
        c.codigo                                                   AS cod_pro,
        MAX(COALESCE(p.nombre, c.proveedor, c.codigo))             AS proveedor,
        MAX(c."proveedorId")                                       AS proveedor_id,
        BOOL_OR(COALESCE(p."pagoAutomatico", false))               AS pago_automatico,
        TO_CHAR(MIN(c.fecha), 'YYYY-MM-DD')                        AS fecha,
        SUM(COALESCE(c."importeManual", c.importe))                AS total14,
        COALESCE(BOOL_AND(NOT ${visible}) FILTER (WHERE NOT ${esPercepcion}), false) AS oculto,
        STRING_AGG(DISTINCT COALESCE(rc.nombre, 'Sin Rubro'), ', ') FILTER (WHERE NOT ${visible} AND NOT ${esPercepcion}) AS rubros_ocultos,
        STRING_AGG(DISTINCT COALESCE(cc.nombre, c.concepto), ' · ') AS conceptos
      FROM compras c
      LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
      LEFT JOIN proveedores p           ON p.id = c."proveedorId"
      WHERE c."puntoDeVentaId" = ${pdvId}
        AND c.comprobante IS NOT NULL
        AND c.codigo IS NOT NULL
        AND UPPER(LEFT(c.comprobante, 1)) NOT IN ('E', 'G')
        AND c.fecha >= ${desde}::date
        AND c.fecha < NOW() + INTERVAL '60 days'
      GROUP BY c.comprobante, c.codigo
    ),
    pg AS (
      SELECT
        comprobante, "codPro",
        SUM(importe)  AS pagado,
        MAX(total)    AS total80,
        JSON_AGG(JSON_BUILD_OBJECT(
          'fecha', TO_CHAR("fechaPago", 'YYYY-MM-DD'),
          'importe', importe::float8,
          'medio', medio
        ) ORDER BY "fechaPago", secuencia) AS pagos
      FROM pagos
      WHERE "puntoDeVentaId" = ${pdvId}
      GROUP BY comprobante, "codPro"
    )
    SELECT
      f.comprobante,
      f.cod_pro,
      f.proveedor,
      f.proveedor_id,
      f.fecha,
      COALESCE(pg.total80, f.total14)::float8          AS total,
      COALESCE(pg.pagado, 0)::float8                   AS pagado,
      CASE WHEN f.oculto THEN COALESCE(f.rubros_ocultos, 'Rubro oculto') END AS rubro_oculto,
      f.pago_automatico,
      (fz.id IS NOT NULL)                              AS forzada,
      f.conceptos,
      pg.pagos
    FROM f
    LEFT JOIN pg ON pg.comprobante = f.comprobante AND pg."codPro" = f.cod_pro
    LEFT JOIN impagas_forzadas fz
      ON fz."puntoDeVentaId" = ${pdvId} AND fz.comprobante = f.comprobante AND fz."codPro" = f.cod_pro
    WHERE ABS(COALESCE(pg.total80, f.total14) - COALESCE(pg.pagado, 0)) > 1
    ORDER BY f.fecha
  `;
}
