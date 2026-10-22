import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  items: z.array(z.object({
    pdvId: z.number().int().positive(),
    comprobante: z.string().min(1),
    codPro: z.string().min(1),
  })).min(1).max(2000),
});

async function leer(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  return parsed.success ? parsed.data.items : null;
}

// POST: pasar a Impagas (aunque tengan motivo de exclusión).
export async function POST(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const items = await leer(request);
  if (!items) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const res = await prisma.impagaForzada.createMany({
    data: items.map((i) => ({ puntoDeVentaId: i.pdvId, comprobante: i.comprobante, codPro: i.codPro })),
    skipDuplicates: true,
  });
  return NextResponse.json({ ok: true, count: res.count });
}

// DELETE: volver a excluir.
export async function DELETE(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const items = await leer(request);
  if (!items) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const res = await prisma.impagaForzada.deleteMany({
    where: { OR: items.map((i) => ({ puntoDeVentaId: i.pdvId, comprobante: i.comprobante, codPro: i.codPro })) },
  });
  return NextResponse.json({ ok: true, count: res.count });
}
