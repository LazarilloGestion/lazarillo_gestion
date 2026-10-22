import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  proveedorId: z.number().int().positive(),
  pagoAutomatico: z.boolean(),
});

// PATCH: el proveedor cobra solo (débito automático, retención) → todas sus
// facturas, también las futuras, quedan en Excluidas. Se puede quitar.
// Al marcarlo se limpian las que se habían pasado a mano a Impagas: marcar
// "pago automático" es decir que ninguna de ese proveedor se paga a mano.
export async function PATCH(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { proveedorId, pagoAutomatico } = parsed.data;

  const prov = await prisma.proveedor.findUnique({ where: { id: proveedorId }, select: { codigo: true } });
  if (!prov) return NextResponse.json({ error: "Proveedor not found" }, { status: 404 });

  await prisma.proveedor.update({ where: { id: proveedorId }, data: { pagoAutomatico } });
  if (pagoAutomatico) {
    await prisma.impagaForzada.deleteMany({ where: { codPro: prov.codigo } });
  }
  return NextResponse.json({ ok: true });
}
