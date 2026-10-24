import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

// Block de notas del menú lateral: una nota por usuario (email).
export async function GET() {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const email = user.email ?? "";
  const nota = await prisma.notaUsuario.findUnique({ where: { email } });
  return NextResponse.json({ texto: nota?.texto ?? "", actualizadoEn: nota?.actualizadoEn ?? null });
}

const putSchema = z.object({ texto: z.string().max(20000) });

export async function PUT(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const email = user.email ?? "";
  if (!email) return NextResponse.json({ error: "Usuario sin email" }, { status: 400 });
  const nota = await prisma.notaUsuario.upsert({
    where: { email },
    create: { email, texto: parsed.data.texto },
    update: { texto: parsed.data.texto },
  });
  return NextResponse.json({ ok: true, actualizadoEn: nota.actualizadoEn });
}
