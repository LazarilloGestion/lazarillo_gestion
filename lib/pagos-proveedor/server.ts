import { Prisma, type PrismaClient } from "@prisma/client";
import { claveFactura, combinarPagos, type PagoSimple } from "./imputar";

// SERVIDOR. Saldo de facturas de un proveedor (14 + informe 80 + pagos de Lazarillo)
// y disponible de sus pagos a cuenta.

type Db = PrismaClient | Prisma.TransactionClient;

export interface SaldoFactura {
  key: string;
  pdvId: number;
  comprobante: string;
  fecha: string;
  total: number;
  pagado: number;
  saldo: number;
  existe: boolean; // la factura está en el 14 o en el 80
}

interface SaldoSqlRow {
  pdv: number; cpb: string; fecha14: string | null; fecha80: string | null;
  total14: number | null; total80: number | null;
  p80: PagoSimple[] | null; plz: PagoSimple[] | null;
}

export async function saldosFacturas(db: Db, codPro: string, facturas: { pdvId: number; comprobante: string }[]): Promise<Map<string, SaldoFactura>> {
  const res = new Map<string, SaldoFactura>();
  if (!facturas.length) return res;
  const rows = await db.$queryRaw<SaldoSqlRow[]>(Prisma.sql`
    WITH k AS (
      SELECT * FROM UNNEST(${facturas.map((f) => f.pdvId)}::int[], ${facturas.map((f) => f.comprobante)}::text[]) AS k(pdv, cpb)
    )
    SELECT k.pdv, k.cpb,
      (SELECT TO_CHAR(MIN(COALESCE(c."fechaManual", c.fecha)), 'YYYY-MM-DD') FROM compras c
        WHERE c."puntoDeVentaId" = k.pdv AND c.comprobante = k.cpb AND c.codigo = ${codPro}) AS fecha14,
      (SELECT SUM(COALESCE(c."importeManual", c.importe))::float8 FROM compras c
        WHERE c."puntoDeVentaId" = k.pdv AND c.comprobante = k.cpb AND c.codigo = ${codPro}) AS total14,
      (SELECT TO_CHAR(MIN(p.fecha), 'YYYY-MM-DD') FROM pagos p
        WHERE p."puntoDeVentaId" = k.pdv AND p.comprobante = k.cpb AND p."codPro" = ${codPro}) AS fecha80,
      (SELECT MAX(p.total)::float8 FROM pagos p
        WHERE p."puntoDeVentaId" = k.pdv AND p.comprobante = k.cpb AND p."codPro" = ${codPro}) AS total80,
      (SELECT JSON_AGG(JSON_BUILD_OBJECT('fecha', TO_CHAR(p."fechaPago", 'YYYY-MM-DD'), 'importe', p.importe::float8)) FROM pagos p
        WHERE p."puntoDeVentaId" = k.pdv AND p.comprobante = k.cpb AND p."codPro" = ${codPro}) AS p80,
      (SELECT JSON_AGG(JSON_BUILD_OBJECT('fecha', TO_CHAR(pp.fecha, 'YYYY-MM-DD'), 'importe', a.importe::float8))
        FROM aplicaciones_pago_proveedor a JOIN pagos_proveedor pp ON pp.id = a."pagoId" AND pp."anuladoEn" IS NULL
        WHERE a."pdvId" = k.pdv AND a.comprobante = k.cpb AND a."codPro" = ${codPro}) AS plz
    FROM k
  `);
  for (const r of rows) {
    const total = Number(r.total80 ?? r.total14 ?? 0);
    const { pagado } = combinarPagos(r.p80 ?? [], r.plz ?? [], total);
    res.set(claveFactura(r.pdv, r.cpb), {
      key: claveFactura(r.pdv, r.cpb), pdvId: r.pdv, comprobante: r.cpb,
      fecha: r.fecha14 ?? r.fecha80 ?? "", total, pagado, saldo: Math.max(0, Math.round((total - pagado) * 100) / 100),
      existe: r.total14 != null || r.total80 != null,
    });
  }
  return res;
}

export interface PagoACuenta {
  id: number; fecha: string; importe: number; medio: string; referencia: string | null; pdvPagaId: number; disponible: number;
}

// Pagos vigentes del proveedor con disponible (lo que no está imputado).
export async function pagosACuenta(db: Db, codPro: string): Promise<PagoACuenta[]> {
  const rows = await db.$queryRaw<{ id: number; fecha: string; importe: number; medio: string; referencia: string | null; pdv: number; aplicado: number }[]>(Prisma.sql`
    SELECT pp.id, TO_CHAR(pp.fecha, 'YYYY-MM-DD') AS fecha, pp.importe::float8 AS importe, pp.medio, pp.referencia, pp."pdvPagaId" AS pdv,
      COALESCE((SELECT SUM(a.importe) FROM aplicaciones_pago_proveedor a WHERE a."pagoId" = pp.id), 0)::float8 AS aplicado
    FROM pagos_proveedor pp
    WHERE pp."codPro" = ${codPro} AND pp."anuladoEn" IS NULL
    ORDER BY pp.fecha, pp.id
  `);
  return rows
    .map((r) => ({ id: r.id, fecha: r.fecha, importe: Number(r.importe), medio: r.medio, referencia: r.referencia, pdvPagaId: r.pdv, disponible: Math.round((Number(r.importe) - Number(r.aplicado)) * 100) / 100 }))
    .filter((p) => p.disponible > 0.004);
}

// Un solo movimiento de pagos por proveedor a la vez (dos pestañas pagando lo mismo).
export async function bloquearProveedor(tx: Prisma.TransactionClient, codPro: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pagos-proveedor:${codPro}`}))`;
}

export async function registrarEventoPago(tx: Prisma.TransactionClient, pagoId: number, tipo: string, detalle: string | null, importe: number | null, usuario: string | null) {
  await tx.eventoPagoProveedor.create({
    data: { pagoId, tipo, detalle, importe: importe == null ? null : new Prisma.Decimal(importe), usuario },
  });
}

// El ID de la transferencia no se puede repetir (ni en pagos a proveedores ni en Impagas).
export async function referenciaRepetida(db: Db, referencia: string, exceptoPago?: number): Promise<boolean> {
  const [prov, interno] = await Promise.all([
    db.pagoProveedor.findFirst({ where: { referencia, anuladoEn: null, ...(exceptoPago ? { id: { not: exceptoPago } } : {}) }, select: { id: true } }),
    db.pagoInterno.findUnique({ where: { referencia }, select: { id: true } }),
  ]);
  return !!prov || !!interno;
}
