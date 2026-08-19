import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { patchReglaSchema } from "@/lib/apertura/schemas";
import { encontrarSuperposicion } from "@/lib/apertura/validaciones";
import { aplicarRegla, revertirRegla } from "@/lib/apertura/motor";
import type { ReglaVigencia } from "@/lib/apertura/vigencia";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseId(idRaw: string): number | null {
  const id = Number(idRaw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = patchReglaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 422 });
  }

  const existente = await prisma.reglaApertura.findUnique({ where: { id } });
  if (!existente) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  if (parsed.data.accion === "desactivar") {
    // Solo detiene aplicación futura — distribuciones ya generadas quedan
    // como historial (sección 7 del diseño). No revierte nada.
    const regla = await prisma.reglaApertura.update({ where: { id }, data: { estado: "inactiva" } });
    return NextResponse.json({ data: regla });
  }

  // accion === "editar": la spec pide recalcular todos los registros del
  // período de la regla, incluyendo históricos ("lo que manda es la fecha de
  // la regla siempre"). Se implementa como revertir + reaplicar completo —
  // más simple y correcto que un diff parcial, resultado final idéntico.
  const { modo, fechaDesde, fechaHasta, extremosInclusivos, destinos } = parsed.data;
  const vigenciaNueva: ReglaVigencia = {
    modo,
    fechaDesde: fechaDesde ? new Date(fechaDesde) : null,
    fechaHasta: fechaHasta ? new Date(fechaHasta) : null,
    extremosInclusivos,
  };

  const otras = await prisma.reglaApertura.findMany({
    where: { entidadId: existente.entidadId, nivel: "concepto", estado: "activa", NOT: { id } },
    select: { id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true },
  });
  const conflictoId = encontrarSuperposicion(
    vigenciaNueva,
    otras.map((r) => ({
      id: r.id,
      modo: r.modo as ReglaVigencia["modo"],
      fechaDesde: r.fechaDesde,
      fechaHasta: r.fechaHasta,
      extremosInclusivos: r.extremosInclusivos,
    }))
  );
  if (conflictoId !== null) {
    return NextResponse.json({ error: `Superposición con la regla existente #${conflictoId}` }, { status: 409 });
  }

  try {
    const { regla, comprasAfectadas } = await prisma.$transaction(
      async (tx) => {
        await revertirRegla(tx, id);
        await tx.destinoRegla.deleteMany({ where: { reglaId: id } });

        const regla = await tx.reglaApertura.update({
          where: { id },
          data: {
            modo,
            fechaDesde: vigenciaNueva.fechaDesde,
            fechaHasta: vigenciaNueva.fechaHasta,
            extremosInclusivos,
            destinos: {
              create: destinos.map((d) => ({
                localId: d.localId ?? null,
                puntoDeVentaId: d.puntoDeVentaId ?? null,
                porcentaje: d.porcentaje,
              })),
            },
          },
          include: { destinos: true },
        });

        const resultado = await aplicarRegla(tx, {
          reglaId: regla.id,
          entidadId: existente.entidadId,
          vigencia: vigenciaNueva,
          // Number(x.toString()), no Number(x) directo — mismo patrón que pivot usa.
          destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
        });

        return { regla, comprasAfectadas: resultado.comprasAfectadas };
      },
      { timeout: 55000 }
    );

    return NextResponse.json({ data: regla, comprasAfectadas });
  } catch (err) {
    console.error("[PATCH /api/apertura/reglas/[id]]", err);
    return NextResponse.json({ error: "Error interno al editar la regla" }, { status: 500 });
  }
}

// _request: la firma de un route handler de Next requiere el primer parámetro
// aunque no se use el body — mismo criterio que evitar "any"/silenciar lint,
// se nombra explícitamente en vez de omitirlo.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const existente = await prisma.reglaApertura.findUnique({ where: { id } });
  if (!existente) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  try {
    const { comprasRevertidas } = await prisma.$transaction(
      async (tx) => {
        const resultado = await revertirRegla(tx, id);
        await tx.destinoRegla.deleteMany({ where: { reglaId: id } });
        await tx.reglaApertura.delete({ where: { id } });
        return resultado;
      },
      { timeout: 55000 }
    );

    return NextResponse.json({ ok: true, comprasRevertidas });
  } catch (err) {
    console.error("[DELETE /api/apertura/reglas/[id]]", err);
    return NextResponse.json({ error: "Error interno al eliminar la regla" }, { status: 500 });
  }
}
