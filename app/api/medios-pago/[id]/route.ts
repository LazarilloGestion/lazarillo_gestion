import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { medioSchema, mismoNombre } from "@/lib/medios-pago/abm";

export const dynamic = "force-dynamic";

async function leerId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// PUT: modificar. Si cambia el nombre, los pagos que lo usaban pasan al nombre nuevo
// en la misma transacción (nunca quedan con un medio que no existe).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAuthUser();
  if (response) return response;
  const id = await leerId(params);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const parsed = medioSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  const b = parsed.data;

  const actual = await prisma.medioPago.findUnique({ where: { id } });
  if (!actual) return NextResponse.json({ error: "Ese medio ya no existe." }, { status: 404 });
  const otros = await prisma.medioPago.findMany({ where: { id: { not: id } }, select: { nombre: true } });
  if (otros.some((m) => mismoNombre(m.nombre, b.nombre))) {
    return NextResponse.json({ error: `Ya existe un medio "${b.nombre}".` }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.medioPago.update({ where: { id }, data: { nombre: b.nombre, tipo: b.tipo, pideId: b.pideId, activo: b.activo ?? actual.activo } });
    if (b.nombre !== actual.nombre) {
      await tx.pagoInterno.updateMany({ where: { medio: actual.nombre }, data: { medio: b.nombre } });
    }
  });
  return NextResponse.json({ ok: true });
}

// DELETE: solo si ningún pago lo usa; si tiene pagos, se desactiva (deja de ofrecerse).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAuthUser();
  if (response) return response;
  const id = await leerId(params);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const actual = await prisma.medioPago.findUnique({ where: { id } });
  if (!actual) return NextResponse.json({ error: "Ese medio ya no existe." }, { status: 404 });
  const usos = await prisma.pagoInterno.count({ where: { medio: actual.nombre } });
  if (usos > 0) {
    return NextResponse.json({ error: `Lo usan ${usos} pago${usos === 1 ? "" : "s"}: desactivalo en vez de borrarlo.` }, { status: 409 });
  }
  await prisma.medioPago.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
