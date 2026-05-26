import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";

const patchSchema = z.object({
  importeManual:        z.number().nullable().optional(),
  fechaManual:          z.string().datetime({ offset: true }).nullable().optional(),
  conceptoCodigoManual: z.string().max(50).nullable().optional(),
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

  const { importeManual, fechaManual, conceptoCodigoManual } = parsed.data;

  try {
    const updated = await prisma.compra.update({
      where: { rowId },
      data: {
        ...(importeManual !== undefined && { importeManual }),
        ...(fechaManual !== undefined && { fechaManual: fechaManual !== null ? new Date(fechaManual) : null }),
        ...(conceptoCodigoManual !== undefined && { conceptoCodigoManual }),
      },
      select: { rowId: true, importeManual: true, fechaManual: true, conceptoCodigoManual: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
      if (err.code === "P2003") return NextResponse.json({ error: "Concepto no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
