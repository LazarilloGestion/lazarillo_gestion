import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { comprobanteDe, TIPOS_COMPROBANTE, type TipoComprobante } from "@/lib/facturas/armar";
import { normalizarComprobante, esTicket } from "@/lib/facturas/saltear-lazarillo";

export const dynamic = "force-dynamic";

// Detección de factura ya cargada (modal de carga): mismo proveedor + tipo + Nº
// en el mismo local, venga de MaxiRest o de Lazarillo. Igual que al guardar: las NC
// sin la letra (NC / NcA) y los tickets también por fecha (su número no es único).
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = new URL(request.url).searchParams;
  const proveedorId = Number(sp.get("proveedorId"));
  const localId = Number(sp.get("localId"));
  const tipo = sp.get("tipo") as TipoComprobante;
  const prefijo = sp.get("prefijo") ?? "", numero = sp.get("numero") ?? "";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("fecha") ?? "") ? sp.get("fecha")! : null;
  if (!Number.isInteger(proveedorId) || !Number.isInteger(localId) || !(tipo in TIPOS_COMPROBANTE)
    || !/^\d{1,4}$/.test(prefijo) || !/^\d{1,8}$/.test(numero)) {
    return NextResponse.json({ existe: false });
  }
  const prov = await prisma.proveedor.findUnique({ where: { id: proveedorId }, select: { codigo: true } });
  if (!prov) return NextResponse.json({ existe: false });
  const { comprobante } = comprobanteDe(tipo, prefijo, numero);
  const filas = await prisma.$queryRaw<{ fecha: Date | null; total: number; origen: string | null }[]>`
    SELECT MIN(fecha) AS fecha, SUM(COALESCE("importeManual", importe))::float8 AS total, MAX(origen) AS origen
    FROM compras WHERE "localId" = ${localId} AND codigo = ${prov.codigo}
      AND regexp_replace(UPPER(comprobante), '^NC[ABC]?', 'NC') = ${normalizarComprobante(comprobante)}
      AND (${!esTicket(comprobante)} OR ${fecha}::date IS NULL OR fecha::date = ${fecha}::date)
    HAVING COUNT(*) > 0
  `;
  const f = filas[0];
  if (!f) return NextResponse.json({ existe: false });
  return NextResponse.json({
    existe: true,
    origen: f.origen === "lazarillo" ? "lazarillo" : "maxirest",
    fecha: f.fecha?.toISOString().slice(0, 10) ?? null,
    total: f.total,
  });
}
