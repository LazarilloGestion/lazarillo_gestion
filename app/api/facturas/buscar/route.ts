import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

// GET ?pdvId&comprobante&codPro — una fila del 14 de esa factura, para abrirla con
// GET /api/facturas/[rowId] (ver la factura desde Impagas en el celu, Diego 28/10/2026).
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const pdvId = Number(sp.get("pdvId"));
  const comprobante = sp.get("comprobante")?.trim();
  const codPro = sp.get("codPro")?.trim();
  if (!Number.isInteger(pdvId) || pdvId <= 0 || !comprobante || !codPro) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const c = await prisma.compra.findFirst({
    where: { puntoDeVentaId: pdvId, comprobante, codigo: codPro },
    select: { rowId: true }, orderBy: { rowId: "asc" },
  });
  if (!c) return NextResponse.json({ error: "No encontré la factura" }, { status: 404 });
  return NextResponse.json({ rowId: c.rowId });
}
