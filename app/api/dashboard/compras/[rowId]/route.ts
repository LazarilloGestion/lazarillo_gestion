import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { reevaluarCompra } from "@/lib/apertura/reevaluacion";
import { z } from "zod";

// La reevaluación corre el motor de apertura dentro de la request (revierte la
// distribución vieja y reaplica la regla que corresponda) — mismo criterio que
// los endpoints de reglas.
export const maxDuration = 60;

const patchSchema = z.object({
  importeManual:        z.number().nullable().optional(),
  fechaManual:          z.string().datetime({ offset: true }).nullable().optional(),
  conceptoCodigoManual: z.string().max(50).nullable().optional(),
  observacManual:       z.string().max(500).nullable().optional().transform((v) => (v === "" ? null : v)),
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

  const { importeManual, fechaManual, conceptoCodigoManual, observacManual } = parsed.data;

  const compra = await prisma.compra.findUnique({ where: { rowId }, select: { rowId: true } });
  if (!compra) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });

  // Solo un cambio en un campo que afecta el matching de reglas dispara la
  // reevaluación — observacManual no cambia a qué regla pertenece la compra.
  const afectaMatching =
    importeManual !== undefined || fechaManual !== undefined || conceptoCodigoManual !== undefined;

  try {
    // La reevaluación va en la MISMA $transaction que el update: si el motor
    // falla, el update de la compra también se revierte (nunca queda editada
    // sin reevaluar).
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.compra.update({
        where: { rowId },
        data: {
          ...(importeManual !== undefined && { importeManual }),
          ...(fechaManual !== undefined && { fechaManual: fechaManual !== null ? new Date(fechaManual) : null }),
          ...(conceptoCodigoManual !== undefined && { conceptoCodigoManual }),
          ...(observacManual !== undefined && { observacManual }),
        },
        select: { rowId: true, importeManual: true, fechaManual: true, conceptoCodigoManual: true, observacManual: true },
      });

      const reeval = afectaMatching
        ? await reevaluarCompra(tx, rowId)
        : { reevaluada: false, distribuidaAhora: false };

      return { updated, reeval };
    });

    return NextResponse.json({ ...result.updated, ...result.reeval });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
      if (err.code === "P2003") return NextResponse.json({ error: "Concepto no encontrado" }, { status: 404 });
    }
    console.error("[PATCH /api/dashboard/compras/[rowId]]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
