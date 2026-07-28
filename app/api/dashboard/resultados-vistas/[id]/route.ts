import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";

// `nombre` sola = renombrar. `meses` presente = sobrescribir el snapshot completo
// (param/value/label/conceptosVisibles van todos juntos con `meses`, igual que en el
// POST de creación) — las dos cosas pueden venir juntas o por separado.
const patchSchema = z.object({
  nombre: z.string().min(1).max(60).optional(),
  param: z.enum(["rubroCodigo", "conceptoCodigo", "proveedorId", "observacionQuery"]).nullable().optional(),
  value: z.string().min(1).nullable().optional(),
  label: z.string().min(1).nullable().optional(),
  conceptosVisibles: z.array(z.string()).optional(),
  meses: z.array(z.number().int().min(1).max(12)).optional(),
}).refine(
  (d) => d.nombre !== undefined || d.meses !== undefined,
  { message: "Nada para actualizar" }
).refine(
  (d) => d.meses === undefined || !!d.param || (d.conceptosVisibles?.length ?? 0) > 0,
  { message: "La vista necesita un filtro de búsqueda o conceptos visibles" }
);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 422 });
  }

  const data: Prisma.ResultadosVistaGuardadaUpdateInput = {};
  if (parsed.data.nombre !== undefined) data.nombre = parsed.data.nombre;
  if (parsed.data.meses !== undefined) {
    data.param = parsed.data.param ?? null;
    data.value = parsed.data.value ?? null;
    data.label = parsed.data.label ?? null;
    data.conceptosVisibles = parsed.data.conceptosVisibles ?? [];
    data.meses = parsed.data.meses;
  }

  try {
    const updated = await prisma.resultadosVistaGuardada.update({
      where: { id: idNum },
      data,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Vista no encontrada" }, { status: 404 });
    }
    console.error("[PATCH /api/dashboard/resultados-vistas/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  try {
    await prisma.resultadosVistaGuardada.delete({ where: { id: idNum } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Vista no encontrada" }, { status: 404 });
    }
    console.error("[DELETE /api/dashboard/resultados-vistas/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
