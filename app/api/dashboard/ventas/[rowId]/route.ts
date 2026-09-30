import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";

const patchSchema = z.object({
  importeManual: z.number().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { rowId } = await params;
  if (!rowId) return NextResponse.json({ error: "rowId requerido" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 422 });
  }

  const { importeManual } = parsed.data;

  try {
    const updated = await prisma.venta.update({
      where: { rowId },
      data: {
        ...(importeManual !== undefined && { importeManual }),
      },
      select: { rowId: true, importeManual: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    }
    console.error("[PATCH /api/dashboard/ventas/[rowId]]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
