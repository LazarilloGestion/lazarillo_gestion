import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

// "Ya no va" de Sin carga: POST lo marca en el PDV (deja de aparecer), DELETE ?id lo vuelve a mostrar.
// "Este mes no": la misma marca con la clave + "@YYYY-MM" (solo ese mes).
// ARCA (Diego 28/10/2026): "a:<cuit-tipo-pv-nro>" = no se carga, "k:<…>" = revisado, está bien.
// Son de la empresa, no de un PDV: van con pdvId 0.
const schema = z.union([
  z.object({
    pdvId: z.number().int().positive(),
    clave: z.string().regex(/^[pc]:[^\s@]{1,40}(@\d{4}-\d{2})?$/),
    nombre: z.string().max(200).optional().nullable(),
  }),
  z.object({
    pdvId: z.literal(0),
    clave: z.string().regex(/^[ak]:\d{11}-\d{1,3}-\d{1,5}-\d{1,8}$/),
    nombre: z.string().max(200).optional().nullable(),
  }),
]);

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const b = schema.safeParse(await request.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const d = await prisma.sinCargaDescarte.upsert({
    where: { pdvId_clave: { pdvId: b.data.pdvId, clave: b.data.clave } },
    update: {},
    create: { ...b.data, nombre: b.data.nombre ?? null, creadoPor: user.email ?? user.id },
  });
  return NextResponse.json({ ok: true, id: d.id });
}

export async function DELETE(request: NextRequest) {
  const { response } = await requireAuthUser();
  if (response) return response;
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  await prisma.sinCargaDescarte.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
