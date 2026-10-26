import { Prisma } from "@prisma/client";
import { impagasDesde } from "@/lib/impagas/query";

// Switch Económica / Financiera del panel (punto 4 de Etapa 3, Diego 26/10/2026).
//
// Las consultas del panel leen las compras de `v_compras_distribuidas` y ubican
// cada fila en el mes de COALESCE(fechaManual, fecha). Esta función devuelve la
// fuente a usar en lugar de la vista, con las MISMAS columnas (+ "pagoRef"), y
// según el modo cambia qué fecha (e importe) cuenta:
//
// ECONÓMICA (por fecha de factura):
//   - Sueldos (E): el mes que liquidan (PERIODO del 14), no el día que se pagaron.
//   - Una fecha editada en Lazarillo (fechaManual) sigue mandando.
//
// FINANCIERA (por fecha de pago):
//   - Gastos varios y sueldos: FECHA_PAGO del 14 (si la PC todavía no la trae, la fecha del gasto).
//   - Facturas: una fila por cada pago del informe 80, en el mes del pago, por la
//     parte que ese pago cubre (importe de la fila × pago / total del comprobante).
//     Una factura impaga no suma; una parcial suma solo lo pagado.
//   - Sin pagos pero cuentan en su fecha: notas de crédito, proveedores con pago
//     automático y comprobantes anteriores a la cobertura del 80 (IMPAGAS_DESDE).
//   - Los ingresos NO cambian (Diego: todavía no hay detalle de cobros por forma de pago).
export type ModoPanel = "economica" | "financiera";

export function esModoPanel(v: unknown): v is ModoPanel {
  return v === "economica" || v === "financiera";
}

const COLS = (b: string) => Prisma.raw(`
  ${b}."rowId", ${b}."distribucionId", ${b}."localId", ${b}."puntoDeVentaId",
  ${b}."localIdOrigen", ${b}."puntoDeVentaIdOrigen",
  ${b}."conceptoCodigo", ${b}."conceptoCodigoManual", ${b}.concepto, ${b}.detalle,
  ${b}.observac, ${b}."observacManual", ${b}.proveedor, ${b}."proveedorId", ${b}.codigo`);

export function fuenteCompras(modo: ModoPanel | undefined, desde = impagasDesde(null, process.env.IMPAGAS_DESDE)): Prisma.Sql {
  if (modo !== "financiera") {
    return Prisma.sql`(
      SELECT ${COLS("v")},
        v.importe, v."importeManual",
        COALESCE(co.periodo, v.fecha) AS fecha, v."fechaManual",
        NULL::text AS "pagoRef"
      FROM v_compras_distribuidas v
      JOIN compras co ON co."rowId" = v."rowId"
    )`;
  }
  return Prisma.sql`(
    WITH base AS (
      SELECT v.*,
        co.comprobante                          AS comp,
        co."fechaPago"                          AS fpago,
        co."puntoDeVentaId"                     AS pdv_compra,
        (co.comprobante IS NULL OR co.codigo IS NULL
          OR UPPER(LEFT(co.comprobante, 1)) IN ('E', 'G'))  AS es_gv,
        COALESCE(pr."pagoAutomatico", false)    AS auto
      FROM v_compras_distribuidas v
      JOIN compras co           ON co."rowId" = v."rowId"
      LEFT JOIN proveedores pr  ON pr.id = co."proveedorId"
    ),
    pg AS (
      SELECT "rowId" AS pago_id, "puntoDeVentaId", comprobante, "codPro", importe, total, "fechaPago"
      FROM pagos
      WHERE "fechaPago" IS NOT NULL AND importe IS NOT NULL
    ),
    tot14 AS (
      SELECT "puntoDeVentaId", comprobante, codigo, SUM(COALESCE("importeManual", importe)) AS total
      FROM compras
      WHERE comprobante IS NOT NULL
      GROUP BY "puntoDeVentaId", comprobante, codigo
    )
    -- Gastos varios y sueldos: por su fecha de pago.
    SELECT ${COLS("b")},
      b.importe, b."importeManual",
      COALESCE(b.fpago, b."fechaManual", b.fecha) AS fecha, NULL::timestamp(3) AS "fechaManual",
      NULL::text AS "pagoRef"
    FROM base b
    WHERE b.es_gv
    UNION ALL
    -- Facturas con pagos en el 80: una fila por pago, por la parte que cubre.
    SELECT ${COLS("b")},
      COALESCE(b."importeManual", b.importe) * pg.importe
        / COALESCE(NULLIF(pg.total, 0), NULLIF(t.total, 0))  AS importe,
      NULL::numeric AS "importeManual",
      pg."fechaPago" AS fecha, NULL::timestamp(3) AS "fechaManual",
      pg.pago_id AS "pagoRef"
    FROM base b
    JOIN pg ON pg."puntoDeVentaId" = b.pdv_compra AND pg.comprobante = b.comp AND pg."codPro" = b.codigo
    LEFT JOIN tot14 t ON t."puntoDeVentaId" = b.pdv_compra AND t.comprobante = b.comp AND t.codigo = b.codigo
    WHERE NOT b.es_gv
    UNION ALL
    -- Sin pagos en el 80 pero cuentan en su fecha (NC, pago automático, antes de la cobertura).
    SELECT ${COLS("b")},
      b.importe, b."importeManual",
      b.fecha, b."fechaManual",
      NULL::text AS "pagoRef"
    FROM base b
    WHERE NOT b.es_gv
      AND NOT EXISTS (
        SELECT 1 FROM pg
        WHERE pg."puntoDeVentaId" = b.pdv_compra AND pg.comprobante = b.comp AND pg."codPro" = b.codigo
      )
      AND (UPPER(LEFT(b.comp, 1)) = 'N' OR b.auto OR COALESCE(b."fechaManual", b.fecha) < ${desde}::date)
  )`;
}
