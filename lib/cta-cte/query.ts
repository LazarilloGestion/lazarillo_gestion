import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { impagasDesde } from "@/lib/impagas/query";
import { claveComprobante, estadoPago, type EstadoPago } from "./estado";

// SERVIDOR: cuenta corriente del proveedor y estado de pago de comprobantes
// (14 cruzado con el informe 80). No importar desde componentes cliente.

export interface FacturaCtaCteRow {
  comprobante: string;
  fecha: string | null;
  total: number;
  pagado: number;
  conceptos: string | null;
  row_id: string | null;   // una fila del 14 de esa factura (para ver sus líneas)
  solo80: boolean;         // el 80 trae el pago pero el 14 no tiene la factura
  pagos: { fecha: string; importe: number; medio: string | null; orden: string | null }[] | null;
}

// Todas las facturas del proveedor en el PDV (pagas incluidas), una por comprobante.
export function facturasCtaCteSql(pdvId: number, codPro: string): Prisma.Sql {
  return Prisma.sql`
    WITH f AS (
      SELECT
        c.comprobante,
        TO_CHAR(MIN(COALESCE(c."fechaManual", c.fecha)), 'YYYY-MM-DD') AS fecha,
        SUM(COALESCE(c."importeManual", c.importe))                   AS total14,
        STRING_AGG(DISTINCT COALESCE(cc.nombre, c.concepto), ' · ')    AS conceptos,
        MIN(c."rowId")                                                 AS row_id
      FROM compras c
      LEFT JOIN conceptos_caja cc ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      WHERE c."puntoDeVentaId" = ${pdvId} AND c.codigo = ${codPro} AND c.comprobante IS NOT NULL
      GROUP BY c.comprobante
    ),
    pg AS (
      SELECT
        comprobante,
        TO_CHAR(MIN(fecha), 'YYYY-MM-DD') AS fecha80,
        SUM(importe) AS pagado,
        MAX(total)   AS total80,
        JSON_AGG(JSON_BUILD_OBJECT(
          'fecha', TO_CHAR("fechaPago", 'YYYY-MM-DD'), 'importe', importe::float8, 'medio', medio, 'orden', orden
        ) ORDER BY "fechaPago", secuencia) AS pagos
      FROM pagos
      WHERE "puntoDeVentaId" = ${pdvId} AND "codPro" = ${codPro} AND comprobante IS NOT NULL
      GROUP BY comprobante
    )
    SELECT
      COALESCE(f.comprobante, pg.comprobante)              AS comprobante,
      COALESCE(f.fecha, pg.fecha80)                        AS fecha,
      COALESCE(pg.total80, f.total14, 0)::float8           AS total,
      COALESCE(pg.pagado, 0)::float8                       AS pagado,
      f.conceptos,
      f.row_id,
      (f.comprobante IS NULL)                              AS "solo80",
      pg.pagos
    FROM f
    FULL OUTER JOIN pg ON pg.comprobante = f.comprobante
    ORDER BY 2 DESC NULLS LAST, 1 DESC
  `;
}

export interface ProveedorCtaCteRow { nombre: string | null; razon: string | null; cuit: string | null; pago_automatico: boolean | null }

export function proveedorCtaCteSql(codPro: string, pdvId: number): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(p.nombre, (SELECT MAX(c.proveedor) FROM compras c WHERE c.codigo = ${codPro} AND c."puntoDeVentaId" = ${pdvId})) AS nombre,
           p.razon, p.cuit, p."pagoAutomatico" AS pago_automatico
    FROM (SELECT 1) x LEFT JOIN proveedores p ON p.codigo = ${codPro}
  `;
}

export interface PdvConComprasRow { id: number; local: string; pdv: string; facturas: number }

// PDV donde el proveedor tiene comprobantes (para cambiar de PDV en el modal).
export function pdvsDelProveedorSql(codPro: string): Prisma.Sql {
  return Prisma.sql`
    SELECT pdv.id, l.nombre AS local, pdv.nombre AS pdv, COUNT(DISTINCT c.comprobante)::int AS facturas
    FROM compras c
    JOIN puntos_de_venta pdv ON pdv.id = c."puntoDeVentaId"
    JOIN locales l           ON l.id = pdv."localId"
    WHERE c.codigo = ${codPro} AND c.comprobante IS NOT NULL
    GROUP BY pdv.id, l.nombre, pdv.nombre
    ORDER BY l.nombre, pdv.nombre
  `;
}

// ─── Estado de pago para filas sueltas (semáforo de Detalle de compras) ───────

export interface ClaveEstado { pdvId: number | null; comprobante: string | null; codigo: string | null; fecha: string | null }
export interface EstadoFila { estado: EstadoPago; total: number; pagado: number }

interface EstadoSqlRow { pdv: number; cpb: string; cod: string; total14: number | null; total80: number | null; pagado: number | null; auto: boolean | null }

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
      (SELECT BOOL_OR(pr."pagoAutomatico") FROM proveedores pr WHERE pr.codigo = k.cod) AS auto
    FROM k
  `);
  const desde = impagasDesde(null, process.env.IMPAGAS_DESDE);
  for (const r of rows) {
    const k = `${r.pdv}|${r.cpb}|${r.cod}`;
    const total = Number(r.total80 ?? r.total14 ?? 0);
    const pagado = Number(r.pagado ?? 0);
    const e = estadoPago({ comprobante: r.cpb, fecha: unicas.get(k)?.fecha ?? null, total, pagado, pagoAutomatico: !!r.auto }, desde);
    if (e) res.set(k, { estado: e, total, pagado });
  }
  return res;
}
