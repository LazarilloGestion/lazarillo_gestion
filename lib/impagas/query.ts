import { Prisma } from "@prisma/client";
import { sinRubroVisibleSql } from "@/lib/dashboard/query-builders";

// Desde cuándo se cuentan impagas: antes de esa fecha el informe 80 no cubre
// los comprobantes (en Ramos el 14 de ene–ago 2025 numera las facturas como
// "F" y no cruzan con el 80) y todo aparecería impago. El modal tiene un
// filtro "Desde" (?desde=YYYY-MM-DD); sin él manda IMPAGAS_DESDE o el default.
export const IMPAGAS_DESDE_DEFAULT = "2025-09-01";

export function impagasDesde(param: string | null | undefined, env: string | undefined): string {
  for (const raw of [param, env]) {
    const v = raw?.trim();
    // Años absurdos (un campo a medio escribir: 0002-…) no valen: traerían todo el historial.
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && Number(v.slice(0, 4)) >= 2015) return v;
  }
  return IMPAGAS_DESDE_DEFAULT;
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

// ── Aperturas desde otros PDV ───────────────────────────────────────────────
export interface MovimientoSqlRow {
  key: string;
  pdv_origen_id: number;
  fecha: string;
  comprobante: string | null;
  proveedor: string | null;
  concepto: string | null;
  porcentaje: number;
  importe: number;
  aplicado: number;
  ops: number[] | null; // órdenes de pago que imputaron a este movimiento
  es_empleado: boolean;
  rubro: string | null;
}

// Filas de compras de OTRO PDV aperturadas a este PDV (su parte), con lo que
// ya se le pagó al origen imputado a cada una. Fuera: rubros apagados en
// "Rubros visibles en panel" (retiros, inversiones), igual que en compras.
export function movimientosAperturaSql(pdvId: number, desde: string): Prisma.Sql {
  const visible = Prisma.sql`(COALESCE(rc."visibleEnDashboard", ${sinRubroVisibleSql("visibleEnDashboard")}))`;
  return Prisma.sql`
    SELECT
      c."rowId"                                               AS key,
      c."puntoDeVentaId"                                      AS pdv_origen_id,
      TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD') AS fecha,
      c.comprobante,
      -- Sueldos: el 14 trae solo el nombre del empleado; con la nómina del PDV
      -- origen se completa el apellido (mismo código y mismo nombre).
      COALESCE(p.nombre, NULLIF(TRIM(CONCAT_WS(' ', e.nombre, e.apellido)), ''), c.proveedor, c.codigo) AS proveedor,
      (e.id IS NOT NULL)                                      AS es_empleado,
      COALESCE(cc.nombre, c.concepto)                         AS concepto,
      rc.nombre                                               AS rubro,
      MAX(da.porcentaje)::float8                              AS porcentaje,
      SUM(da."importeCalculado")::float8                      AS importe,
      COALESCE(ap.aplicado, 0)::float8                        AS aplicado,
      ap.ops
    FROM distribuciones_apertura da
    JOIN destinos_regla d             ON d.id = da."destinoId"
    JOIN compras c                    ON c."rowId" = da."compraRowId"
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
    LEFT JOIN proveedores p           ON p.id = c."proveedorId"
    LEFT JOIN empleados e             ON c."proveedorId" IS NULL
                                     AND e."puntoDeVentaId" = c."puntoDeVentaId"
                                     AND e.codigo = c.codigo
                                     AND LOWER(TRIM(e.nombre)) = LOWER(TRIM(c.proveedor))
    LEFT JOIN LATERAL (
      SELECT SUM(a.importe) AS aplicado, ARRAY_AGG(DISTINCT a."pagoId" ORDER BY a."pagoId") AS ops
      FROM aplicaciones_pago_interno a
      JOIN pagos_internos pi ON pi.id = a."pagoId"
      WHERE a."compraRowId" = c."rowId" AND pi."pdvDestinoId" = ${pdvId}
    ) ap ON TRUE
    WHERE d."puntoDeVentaId" = ${pdvId}
      AND c."puntoDeVentaId" IS NOT NULL
      AND c."puntoDeVentaId" <> ${pdvId}
      AND COALESCE(c."fechaManual", c.fecha) >= ${desde}::date
      AND COALESCE(c."fechaManual", c.fecha) < NOW() + INTERVAL '60 days'
      AND ${visible}
    GROUP BY c."rowId", c."puntoDeVentaId", c."fechaManual", c.fecha, c.comprobante, p.nombre, c.proveedor, c.codigo, cc.nombre, c.concepto, rc.nombre, e.id, e.nombre, e.apellido, ap.aplicado, ap.ops
    HAVING ABS(SUM(da."importeCalculado")) > 0.5
    ORDER BY 3, 1
  `;
}

export interface PagoInternoSqlRow {
  id: number;
  pdv_origen_id: number;
  fecha: string;
  importe: number;
  medio: string;
  referencia: string | null;
  aplicado: number;
  movimientos: number;
}

export function pagosInternosSql(pdvId: number): Prisma.Sql {
  return Prisma.sql`
    SELECT pi.id, pi."pdvOrigenId" AS pdv_origen_id, TO_CHAR(pi.fecha, 'YYYY-MM-DD') AS fecha,
           pi.importe::float8 AS importe, pi.medio, pi.referencia,
           COALESCE(SUM(a.importe), 0)::float8 AS aplicado, COUNT(a.id)::int AS movimientos
    FROM pagos_internos pi
    LEFT JOIN aplicaciones_pago_interno a ON a."pagoId" = pi.id
    WHERE pi."pdvDestinoId" = ${pdvId}
    GROUP BY pi.id
    ORDER BY pi.fecha DESC, pi.id DESC
  `;
}
