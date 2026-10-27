import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { fmtComprobante } from "@/lib/impagas/clasificar";
import { bloquearProveedor, registrarEventoPago } from "@/lib/pagos-proveedor/server";

export const dynamic = "force-dynamic";

// DELETE ?pdvId&comprobante: quitar el pago de esa factura. El importe vuelve a quedar a cuenta.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const id = Number((await params).id);
  const sp = request.nextUrl.searchParams;
  const pdvId = Number(sp.get("pdvId"));
  const comprobante = (sp.get("comprobante") ?? "").trim();
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(pdvId) || pdvId <= 0 || !comprobante) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  const pago = await prisma.pagoProveedor.findUnique({ where: { id } });
  if (!pago || pago.anuladoEn) return NextResponse.json({ error: "Ese pago ya no existe o está anulado." }, { status: 404 });
  const quitado = await prisma.$transaction(async (tx) => {
    await bloquearProveedor(tx, pago.codPro);
    const aps = await tx.aplicacionPagoProveedor.findMany({ where: { pagoId: id, pdvId, comprobante } });
    if (!aps.length) return 0;
    await tx.aplicacionPagoProveedor.deleteMany({ where: { id: { in: aps.map((a) => a.id) } } });
    const total = aps.reduce((s, a) => s + Number(a.importe), 0);
    await registrarEventoPago(tx, id, "desimputado", fmtComprobante(comprobante), total, user.email ?? null);
    return total;
  });
  return NextResponse.json({ ok: true, quitado });
}
