import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const vistas = await prisma.resultadosVistaGuardada.findMany({
      orderBy: { nombre: "asc" },
    });
    return NextResponse.json(vistas);
  } catch (err) {
    console.error("[GET /api/dashboard/resultados-vistas]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const postSchema = z.object({
  nombre: z.string().min(1).max(60),
  param: z.enum(["rubroCodigo", "conceptoCodigo", "proveedorId", "observacionQuery"]).optional(),
  value: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  conceptosVisibles: z.array(z.string()).default([]),
  meses: z.array(z.number().int().min(1).max(12)),
}).refine(
  (d) => (!!d.param === !!d.value) && (!!d.param === !!d.label),
  { message: "param, value y label deben venir juntos o no venir" }
).refine(
  (d) => !!d.param || d.conceptosVisibles.length > 0,
  { message: "La vista necesita un filtro de búsqueda o conceptos visibles" }
);

export async function POST(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const vista = await prisma.resultadosVistaGuardada.create({ data: parsed.data });
    return NextResponse.json(vista, { status: 201 });
  } catch (err) {
    console.error("[POST /api/dashboard/resultados-vistas]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
