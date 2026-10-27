import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { medioSchema, mismoNombre } from "@/lib/medios-pago/abm";
import { leerMedios } from "@/lib/medios-pago/leer";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireAuthUser();
  if (response) return response;
  return NextResponse.json(await leerMedios());
}

// POST: alta de un medio. El nombre no se puede repetir (sin distinguir mayúsculas).
export async function POST(request: NextRequest) {
  const { response } = await requireAuthUser();
  if (response) return response;
  const parsed = medioSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  const b = parsed.data;
  const todos = await prisma.medioPago.findMany({ select: { nombre: true, orden: true } });
  if (todos.some((m) => mismoNombre(m.nombre, b.nombre))) {
    return NextResponse.json({ error: `Ya existe un medio "${b.nombre}".` }, { status: 409 });
  }
  const orden = todos.reduce((a, m) => Math.max(a, m.orden), 0) + 1;
  const m = await prisma.medioPago.create({ data: { nombre: b.nombre, tipo: b.tipo, pideId: b.pideId, activo: b.activo ?? true, orden } });
  return NextResponse.json({ id: m.id }, { status: 201 });
}
