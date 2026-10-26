import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { impagasDesde } from "@/lib/impagas/query";
import { claveComprobante, estadoPago, type EstadoPago } from "./estado";

// SERVIDOR: cuenta corriente del proveedor y estado de pago de comprobantes
// (14 cruzado con el informe 80). No importar desde componentes cliente.

export interface FacturaCtaCteRow {
  pdv_id: number;
  pdv: string;             // "Ramos Mejía · Bar"
  comprobante: string;
  fecha: string | null;
  total: number;
  pagado: number;
  conceptos: string | null;
  row_id: string | null;   // una fila del 14 de esa factura (para ver sus líneas)
  solo80: boolean;         // el 80 trae el pago pero el 14 no tiene la factura
  pagos: { fecha: string; importe: number; medio: string | null; orden: string | null }[] | null;
}

// Todas las facturas del proveedor en TODOS los PDV (pagas incluidas), una por
// PDV + comprobante, con los pagos del informe 80.
export function facturasCtaCteSql(codPro: string): Prisma.Sql {
  return Prisma.sql`
    WITH f AS (
      SELECT
        c."puntoDeVentaId"                                             AS pdv_id,
        c.comprobante,
        TO_CHAR(MIN(COALESCE(c."fechaManual", c.fecha)), 'YYYY-MM-DD') AS fecha,
        SUM(COALESCE(c."importeManual", c.importe))                   AS total14,
        STRING_AGG(DISTINCT COALESCE(cc.nombre, c.concepto), ' · ')    AS conceptos,
        MIN(c."rowId")                                                 AS row_id
      FROM compras c
      LEFT JOIN conceptos_caja cc ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      WHERE c.codigo = ${codPro} AND c.comprobante IS NOT NULL AND c."puntoDeVentaId" IS NOT NULL
        -- Solo las compras del proveedor del maestro: el mismo código se repite
        -- en gastos varios y empleados de otros PDV (texto, sin proveedorId).
        AND c."proveedorId" IN (SELECT id FROM proveedores WHERE codigo = ${codPro})
      GROUP BY c."puntoDeVentaId", c.comprobante
    ),
    pg AS (
      SELECT
        "puntoDeVentaId" AS pdv_id,
        comprobante,
        TO_CHAR(MIN(fecha), 'YYYY-MM-DD') AS fecha80,
        SUM(importe) AS pagado,
        MAX(total)   AS total80,
        JSON_AGG(JSON_BUILD_OBJECT(
          'fecha', TO_CHAR("fechaPago", 'YYYY-MM-DD'), 'importe', importe::float8, 'medio', medio, 'orden', orden
        ) ORDER BY "fechaPago", secuencia) AS pagos
      FROM pagos
      WHERE "codPro" = ${codPro} AND comprobante IS NOT NULL AND "puntoDeVentaId" IS NOT NULL
      GROUP BY "puntoDeVentaId", comprobante
    )
    SELECT
      COALESCE(f.pdv_id, pg.pdv_id)                        AS pdv_id,
      CONCAT(l.nombre, ' · ', pdv.nombre)                  AS pdv,
      COALESCE(f.comprobante, pg.comprobante)              AS comprobante,
      COALESCE(f.fecha, pg.fecha80)                        AS fecha,
      COALESCE(pg.total80, f.total14, 0)::float8           AS total,
      COALESCE(pg.pagado, 0)::float8                       AS pagado,
      f.conceptos,
      f.row_id,
      (f.comprobante IS NULL)                              AS "solo80",
      pg.pagos
    FROM f
    FULL OUTER JOIN pg ON pg.comprobante = f.comprobante AND pg.pdv_id = f.pdv_id
    JOIN puntos_de_venta pdv ON pdv.id = COALESCE(f.pdv_id, pg.pdv_id)
    JOIN locales l           ON l.id = pdv."localId"
    ORDER BY 4 DESC NULLS LAST, 3 DESC
  `;
}

export interface ProveedorCtaCteRow { nombre: string | null; razon: string | null; cuit: string | null; pago_automatico: boolean | null }

export function proveedorCtaCteSql(codPro: string): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(p.nombre, (SELECT MAX(c.proveedor) FROM compras c WHERE c.codigo = ${codPro})) AS nombre,
           p.razon, p.cuit, p."pagoAutomatico" AS pago_automatico
    FROM (SELECT 1) x LEFT JOIN proveedores p ON p.codigo = ${codPro}
  `;
}

export interface ProveedorBusquedaRow { cod_pro: string; nombre: string | null; facturas: number }

// Buscador de proveedor del modal: los que tienen comprobantes, por nombre o código.
export function buscarProveedoresSql(q: string): Prisma.Sql {
  const patron = `%${q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return Prisma.sql`
    SELECT c.codigo AS cod_pro, COALESCE(MAX(p.nombre), MAX(c.proveedor)) AS nombre, COUNT(DISTINCT c.comprobante)::int AS facturas
    FROM compras c
    LEFT JOIN proveedores p ON p.codigo = c.codigo
    WHERE c.codigo IS NOT NULL AND c.comprobante IS NOT NULL
    GROUP BY c.codigo
    HAVING ${q ? Prisma.sql`lower(COALESCE(MAX(p.nombre), MAX(c.proveedor), '')) LIKE ${patron} OR c.codigo = ${q}` : Prisma.sql`TRUE`}
    ORDER BY 3 DESC
    LIMIT 12
  `;
}

// ─── Movimientos sin proveedor del maestro (empleados, gastos varios) ─────────
// Se identifican por PDV + código + nombre (el código del ERP se repite entre
// PDV y con "GASTOS VARIOS"). Sueldos y gastos varios no tienen comprobante:
// en MaxiRest se cargan con su pago.

export interface MovimientoCtaCteRow {
  row_id: string; fecha: string | null; comprobante: string | null; concepto: string | null;
  rubro: string | null; observac: string | null; importe: number;
}

export function movimientosCtaCteSql(pdvId: number, codigo: string, nombre: string): Prisma.Sql {
  return Prisma.sql`
    SELECT c."rowId" AS row_id,
           TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD') AS fecha,
           c.comprobante,
           COALESCE(cc.nombre, c.concepto) AS concepto,
           rc.nombre AS rubro,
           COALESCE(c."observacManual", c.observac) AS observac,
           COALESCE(c."importeManual", c.importe, 0)::float8 AS importe
    FROM compras c
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
    WHERE c."puntoDeVentaId" = ${pdvId} AND c.codigo = ${codigo} AND c."proveedorId" IS NULL
      AND LOWER(TRIM(c.proveedor)) = LOWER(TRIM(${nombre}))
    ORDER BY 2 DESC, 1
    LIMIT 5000
  `;
}

export interface EncabezadoMovsRow { pdv: string | null; empleado: string | null }

// PDV y, si es un empleado de la nómina, su nombre completo.
export function encabezadoMovsSql(pdvId: number, codigo: string, nombre: string): Prisma.Sql {
  return Prisma.sql`
    SELECT (SELECT CONCAT(l.nombre, ' · ', pdv.nombre) FROM puntos_de_venta pdv JOIN locales l ON l.id = pdv."localId" WHERE pdv.id = ${pdvId}) AS pdv,
           (SELECT NULLIF(TRIM(CONCAT_WS(' ', e.nombre, e.apellido)), '') FROM empleados e
             WHERE e."puntoDeVentaId" = ${pdvId} AND e.codigo = ${codigo} AND LOWER(TRIM(e.nombre)) = LOWER(TRIM(${nombre})) LIMIT 1) AS empleado
  `;
}

// ─── Estado de pago para filas sueltas (semáforo de Detalle de compras) ───────

export interface ClaveEstado { pdvId: number | null; comprobante: string | null; codigo: string | null; fecha: string | null }
// ultimoPago/pagos: fecha del último pago del 80 y cuántos hubo (columna "Fecha pago" del Detalle de compras).
export interface EstadoFila { estado: EstadoPago; total: number; pagado: number; ultimoPago?: string | null; pagos?: number }

interface EstadoSqlRow { pdv: number; cpb: string; cod: string; total14: number | null; total80: number | null; pagado: number | null; auto: boolean | null; ultimo: string | null; n: number | null }

export async function estadosDePago(claves: ClaveEstado[]): Promise<Map<string, EstadoFila>> {
  const unicas = new Map<string, ClaveEstado>();
  for (const c of claves) {
    const k = claveComprobante(c.pdvId, c.comprobante, c.codigo);
    if (k && !unicas.has(k)) unicas.set(k, c);
  }
  const res = new Map<string, EstadoFila>();
  if (!unicas.size) return res;
  const l = [...unicas.values()];
  const rows = await prisma.$queryRaw<EstadoSqlRow[]>(Prisma.sql`
    WITH k AS (
      SELECT * FROM UNNEST(${l.map((c) => c.pdvId)}::int[], ${l.map((c) => c.comprobante)}::text[], ${l.map((c) => c.codigo)}::text[]) AS k(pdv, cpb, cod)
    )
    SELECT k.pdv, k.cpb, k.cod,
      (SELECT SUM(COALESCE(c."importeManual", c.importe))::float8 FROM compras c
        WHERE c."puntoDeVentaId" = k.pdv AND c.comprobante = k.cpb AND c.codigo = k.cod) AS total14,
      (SELECT MAX(p.total)::float8 FROM pagos p
        WHERE p."puntoDeVentaId" = k.pdv AND p.comprobante = k.cpb AND p."codPro" = k.cod) AS total80,
      (SELECT SUM(p.importe)::float8 FROM pagos p
        WHERE p."puntoDeVentaId" = k.pdv AND p.comprobante = k.cpb AND p."codPro" = k.cod) AS pagado,
      (SELECT BOOL_OR(pr."pagoAutomatico") FROM proveedores pr WHERE pr.codigo = k.cod) AS auto,
      (SELECT TO_CHAR(MAX(p."fechaPago"), 'YYYY-MM-DD') FROM pagos p
        WHERE p."puntoDeVentaId" = k.pdv AND p.comprobante = k.cpb AND p."codPro" = k.cod) AS ultimo,
      (SELECT COUNT(*)::int FROM pagos p
        WHERE p."puntoDeVentaId" = k.pdv AND p.comprobante = k.cpb AND p."codPro" = k.cod) AS n
    FROM k
  `);
  const desde = impagasDesde(null, process.env.IMPAGAS_DESDE);
  for (const r of rows) {
    const k = `${r.pdv}|${r.cpb}|${r.cod}`;
    const total = Number(r.total80 ?? r.total14 ?? 0);
    const pagado = Number(r.pagado ?? 0);
    const e = estadoPago({ comprobante: r.cpb, fecha: unicas.get(k)?.fecha ?? null, total, pagado, pagoAutomatico: !!r.auto }, desde);
    if (e) res.set(k, { estado: e, total, pagado, ultimoPago: r.ultimo, pagos: Number(r.n ?? 0) });
  }
  return res;
}
