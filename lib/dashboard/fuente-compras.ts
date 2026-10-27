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

// Rendimiento (revisión 27/10/2026): la vista ya trae periodo, comprobante y
// fechaPago (no se vuelve a juntar con compras), y en Financiera la base es NOT
// MATERIALIZED para que el filtro de PDV / local / año llegue hasta las tablas en
// vez de armar las ~80 mil filas en cada consulta; los pagos se cruzan por índice y
// el total del 14 solo se calcula cuando el 80 no lo trae. Mismas filas que antes.
export function fuenteCompras(modo: ModoPanel | undefined, desde = impagasDesde(null, process.env.IMPAGAS_DESDE)): Prisma.Sql {
  if (modo !== "financiera") {
    return Prisma.sql`(
      SELECT ${COLS("v")},
        v.importe, v."importeManual",
        COALESCE(v.periodo, v.fecha) AS fecha, v."fechaManual",
        NULL::text AS "pagoRef"
      FROM v_compras_distribuidas v
    )`;
  }
  return Prisma.sql`(
    WITH base AS NOT MATERIALIZED (
      SELECT v.*,
        v.comprobante                           AS comp,
        v."fechaPago"                           AS fpago,
        v."puntoDeVentaIdOrigen"                AS pdv_compra,
        (v.comprobante IS NULL OR v.codigo IS NULL
          OR UPPER(LEFT(v.comprobante, 1)) IN ('E', 'G'))  AS es_gv,
        COALESCE(pr."pagoAutomatico", false)    AS auto
      FROM v_compras_distribuidas v
      LEFT JOIN proveedores pr  ON pr.id = v."proveedorId"
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
        / COALESCE(NULLIF(pg.total, 0), NULLIF((
            SELECT SUM(COALESCE(x."importeManual", x.importe)) FROM compras x
            WHERE x."puntoDeVentaId" = b.pdv_compra AND x.comprobante = b.comp AND x.codigo = b.codigo
          ), 0))  AS importe,
      NULL::numeric AS "importeManual",
      pg."fechaPago" AS fecha, NULL::timestamp(3) AS "fechaManual",
      pg."rowId" AS "pagoRef"
    FROM base b
    JOIN pagos pg ON pg."puntoDeVentaId" = b.pdv_compra AND pg.comprobante = b.comp AND pg."codPro" = b.codigo
      AND pg."fechaPago" IS NOT NULL AND pg.importe IS NOT NULL
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
        SELECT 1 FROM pagos pg
        WHERE pg."puntoDeVentaId" = b.pdv_compra AND pg.comprobante = b.comp AND pg."codPro" = b.codigo
          AND pg."fechaPago" IS NOT NULL AND pg.importe IS NOT NULL
      )
      AND (UPPER(LEFT(b.comp, 1)) = 'N' OR b.auto OR COALESCE(b."fechaManual", b.fecha) < ${desde}::date)
  )`;
}
