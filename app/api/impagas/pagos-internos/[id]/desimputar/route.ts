import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { aplicacionesOpSql, type AplicacionOpSqlRow } from "@/lib/impagas/query";
import { redondear } from "@/lib/impagas/aperturas";
import { fmtComprobante, fmtFecha } from "@/lib/impagas/clasificar";
import { registrarEvento } from "@/lib/impagas/eventos";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // Movimientos (compras.rowId) a los que se les quita la imputación; vacío/ausente = todos.
  keys: z.array(z.string().min(1)).max(10000).optional(),
});

// POST: quitar imputaciones de una orden de pago. El importe vuelve al
// movimiento (queda impago) y pasa al "sin imputar" de la OP.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const keys = parsed.data.keys?.length ? parsed.data.keys : null;

  const pago = await prisma.pagoInterno.findUnique({ where: { id }, select: { id: true, anuladoEn: true } });
  if (!pago || pago.anuladoEn) return NextResponse.json({ error: "Esa orden de pago no existe o está anulada." }, { status: 404 });

  const actuales = (await prisma.$queryRaw<AplicacionOpSqlRow[]>(aplicacionesOpSql(id)))
    .filter((a) => !keys || keys.includes(a.key));
  if (!actuales.length) return NextResponse.json({ error: "No hay imputaciones para quitar." }, { status: 400 });
  const total = redondear(actuales.reduce((s, a) => s + Number(a.importe), 0));
  const uno = actuales.length === 1 ? actuales[0] : null;

  await prisma.$transaction(async (tx) => {
    await tx.aplicacionPagoInterno.deleteMany({
      where: { pagoId: id, ...(keys ? { compraRowId: { in: actuales.map((a) => a.key) } } : {}) },
    });
    await registrarEvento(tx, {
      pagoId: id, tipo: "desimputada", importe: total, usuario: user.email ?? null,
      detalle: uno
        ? `${fmtFecha(uno.fecha)} · ${uno.comprobante ? fmtComprobante(uno.comprobante) : uno.concepto ?? ""} · ${uno.proveedor ?? ""}`.trim()
        : keys ? `${actuales.length} movimientos` : `todas (${actuales.length} movimientos)`,
    });
  });
  return NextResponse.json({ ok: true, quitado: total, movimientos: actuales.length });
}
