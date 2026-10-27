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

// Un rubro cuenta como "apagado" (descartado de Impagas y de la deuda con otros
// PDV) solo si está apagado en Compras Y en Resultados (Diego, 24/10): si se ve
// en alguno de los dos tableros, es un gasto real.
export function rubroVisibleSql(): Prisma.Sql {
  return Prisma.sql`(COALESCE(rc."visibleEnDashboard", ${sinRubroVisibleSql("visibleEnDashboard")})
    OR COALESCE(rc."visibleEnResultados", ${sinRubroVisibleSql("visibleEnResultados")}))`;
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
  pagos: { fecha: string; importe: number; medio: string | null; orden: string | null }[] | null;
  pagos_lz: { fecha: string; importe: number; medio: string; pagoId: number }[] | null; // pagos cargados en Lazarillo
}

// Un comprobante = (PDV, comprobante, código de proveedor): en el 14 una
// factura viene partida en varias filas (conceptos + percepciones).
// Fuera de la vista: filas sin comprobante (gastos varios sin número) y los
// números internos E/G que arma el kit para gastos varios — en MaxiRest un
// gasto vario se carga siempre con su pago.
// Rubro oculto: TODAS las líneas que no son percepción son de rubros apagados
// en "Rubros visibles en panel" (las percepciones no cuentan: Agronatural).
export function impagasSql(pdvId: number, desde: string): Prisma.Sql {
  const visible = rubroVisibleSql();
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
          'medio', medio,
          'orden', orden
        ) ORDER BY "fechaPago", secuencia) AS pagos
      FROM pagos
      WHERE "puntoDeVentaId" = ${pdvId}
      GROUP BY comprobante, "codPro"
    ),
    -- Pagos cargados en Lazarillo (Etapa 4): el route los combina con los del 80.
    lz AS (
      SELECT a.comprobante, a."codPro",
        JSON_AGG(JSON_BUILD_OBJECT('fecha', TO_CHAR(pp.fecha, 'YYYY-MM-DD'), 'importe', a.importe::float8, 'medio', pp.medio, 'pagoId', pp.id)
          ORDER BY pp.fecha, pp.id) AS pagos_lz
      FROM aplicaciones_pago_proveedor a
      JOIN pagos_proveedor pp ON pp.id = a."pagoId" AND pp."anuladoEn" IS NULL
      WHERE a."pdvId" = ${pdvId}
      GROUP BY a.comprobante, a."codPro"
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
      pg.pagos,
      lz.pagos_lz
    FROM f
    LEFT JOIN pg ON pg.comprobante = f.comprobante AND pg."codPro" = f.cod_pro
    LEFT JOIN lz ON lz.comprobante = f.comprobante AND lz."codPro" = f.cod_pro
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
  total_compra: number | null; // total del comprobante (todas las partes)
  aplicado: number;
  ops: number[] | null; // órdenes de pago que imputaron a este movimiento
  es_empleado: boolean;
  rubro: string | null;
}

// Filas de compras de OTRO PDV aperturadas a este PDV (su parte), con lo que
// ya se le pagó al origen imputado a cada una. Fuera: rubros apagados en
// "Rubros visibles en panel" (retiros, inversiones), igual que en compras.
export function movimientosAperturaSql(pdvId: number, desde: string): Prisma.Sql {
  const visible = rubroVisibleSql();
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
      COALESCE(c."importeManual", c.importe)::float8          AS total_compra,
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
    GROUP BY c."rowId", c."puntoDeVentaId", c."fechaManual", c.fecha, c.comprobante, p.nombre, c.proveedor, c.codigo, cc.nombre, c.concepto, rc.nombre, e.id, e.nombre, e.apellido, c."importeManual", c.importe, ap.aplicado, ap.ops
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
    WHERE pi."pdvDestinoId" = ${pdvId} AND pi."anuladoEn" IS NULL
    GROUP BY pi.id
    ORDER BY pi.fecha DESC, pi.id DESC
  `;
}

// ── Detalle de una orden de pago: a qué movimientos está imputada ────────────
export interface AplicacionOpSqlRow {
  key: string;
  fecha: string;
  comprobante: string | null;
  proveedor: string | null;
  concepto: string | null;
  importe: number;
}

export function aplicacionesOpSql(pagoId: number): Prisma.Sql {
  return Prisma.sql`
    SELECT
      c."rowId"                                                 AS key,
      TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')  AS fecha,
      c.comprobante,
      COALESCE(p.nombre, NULLIF(TRIM(CONCAT_WS(' ', e.nombre, e.apellido)), ''), c.proveedor, c.codigo) AS proveedor,
      COALESCE(cc.nombre, c.concepto)                           AS concepto,
      SUM(a.importe)::float8                                    AS importe
    FROM aplicaciones_pago_interno a
    JOIN compras c                    ON c."rowId" = a."compraRowId"
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN proveedores p           ON p.id = c."proveedorId"
    LEFT JOIN empleados e             ON c."proveedorId" IS NULL
                                     AND e."puntoDeVentaId" = c."puntoDeVentaId"
                                     AND e.codigo = c.codigo
                                     AND LOWER(TRIM(e.nombre)) = LOWER(TRIM(c.proveedor))
    WHERE a."pagoId" = ${pagoId}
    GROUP BY c."rowId", c."fechaManual", c.fecha, c.comprobante, p.nombre, e.nombre, e.apellido, c.proveedor, c.codigo, cc.nombre, c.concepto
    ORDER BY 2 DESC, 1
  `;
}

// ── Historial de órdenes de pago entre dos PDV ──────────────────────────────
export interface EventoSqlRow {
  id: number;
  pago_id: number;
  tipo: string;
  detalle: string | null;
  importe: number | null;
  usuario: string | null;
  cuando: string; // dd/mm/aaaa hh:mm (hora de Argentina)
  anulada: boolean;
}

export function historialSql(pdvDestinoId: number, pdvOrigenId: number): Prisma.Sql {
  return Prisma.sql`
    SELECT ev.id, ev."pagoId" AS pago_id, ev.tipo, ev.detalle, ev.importe::float8 AS importe, ev.usuario,
           TO_CHAR((ev."creadoEn" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') AS cuando,
           (pi."anuladoEn" IS NOT NULL) AS anulada
    FROM eventos_pago_interno ev
    JOIN pagos_internos pi ON pi.id = ev."pagoId"
    WHERE pi."pdvDestinoId" = ${pdvDestinoId} AND pi."pdvOrigenId" = ${pdvOrigenId}
    ORDER BY ev."creadoEn" DESC, ev.id DESC
    LIMIT 500
  `;
}

export interface PagoMaxirestSqlRow {
  comprobante: string | null;
  fecha: string | null;
  proveedor: string | null;
  concepto: string | null;
  total: number | null;
  importe: number;
  medio: string | null;
}

// Un pago de MaxiRest (informe 80) = misma orden + mismo día de pago en el PDV.
// En MaxiRest el número de orden se reutiliza (débitos automáticos mes a mes).
export function pagoMaxirestSql(pdvId: number, orden: string, fecha: string): Prisma.Sql {
  return Prisma.sql`
    SELECT comprobante, TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, proveedor, concepto,
           total::float8 AS total, importe::float8 AS importe, medio
    FROM pagos
    WHERE "puntoDeVentaId" = ${pdvId} AND orden = ${orden} AND "fechaPago"::date = ${fecha}::date
    ORDER BY fecha, comprobante, secuencia
  `;
}

export interface FechaOrdenSqlRow { fecha: string; importe: number; comprobantes: number }

export function fechasOrdenMaxirestSql(pdvId: number, orden: string): Prisma.Sql {
  return Prisma.sql`
    SELECT TO_CHAR("fechaPago", 'YYYY-MM-DD') AS fecha, SUM(importe)::float8 AS importe, COUNT(DISTINCT comprobante)::int AS comprobantes
    FROM pagos
    WHERE "puntoDeVentaId" = ${pdvId} AND orden = ${orden} AND "fechaPago" IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `;
}
