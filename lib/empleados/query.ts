import { Prisma } from "@prisma/client";

// SERVIDOR. Movimientos de un empleado (sueldos y adelantos de MaxiRest y de Lazarillo): las filas
// de compras sin comprobante con su código y nombre (como cruza Impagas con la nómina), más las
// filas de las cargas de Lazarillo repartidas a otros PDV (rowId "emp-<id>-…").
export function movimientosEmpleadoSql(pdvId: number, codigo: string, nombre: string, desde: string): Prisma.Sql {
  return Prisma.sql`
    SELECT to_char(COALESCE(c.periodo, c.fecha), 'YYYY-MM') AS periodo,
           to_char(COALESCE(c."fechaPago", c."fechaManual", c.fecha), 'YYYY-MM-DD') AS fecha,
           COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") AS cod,
           TRIM(COALESCE(cc.nombre, c.concepto)) AS concepto,
           COALESCE(c."importeManual", c.importe)::float8 AS importe,
           c.origen, c."cajaPago" AS medio, c."rowId" AS "rowId"
    FROM compras c
    LEFT JOIN conceptos_caja cc ON cc.codigo = COALESCE(c."conceptoCodigoManual", c."conceptoCodigo")
    WHERE c.comprobante IS NULL AND c."proveedorId" IS NULL AND c.codigo = ${codigo}
      AND LOWER(TRIM(c.proveedor)) = LOWER(TRIM(${nombre}))
      AND (c."puntoDeVentaId" = ${pdvId} OR EXISTS (
        SELECT 1 FROM liquidaciones_empleado l
        WHERE l."puntoDeVentaId" = ${pdvId} AND l."empleadoCodigo" = ${codigo} AND c."rowId" LIKE 'emp-' || l.id || '-%'))
      AND COALESCE(c.periodo, c.fecha) >= ${desde}::date
      AND ABS(COALESCE(c."importeManual", c.importe)) > 0.005
    ORDER BY 1 DESC, 2`;
}

export interface MovimientoEmpleado {
  periodo: string; fecha: string; cod: string | null; concepto: string | null; importe: number; origen: string | null; medio: string | null; rowId: string;
}

/** El concepto de caja de los adelantos ("Adelanto Sueldo"; el código cambia por organización). */
export const conceptoAdelantoSql = Prisma.sql`
  SELECT codigo, TRIM(nombre) AS nombre FROM conceptos_caja
  WHERE nombre ILIKE 'adelanto%sueldo%' ORDER BY codigo LIMIT 1`;
