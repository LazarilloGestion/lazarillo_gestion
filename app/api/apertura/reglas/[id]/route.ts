import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { patchReglaSchema } from "@/lib/apertura/schemas";
import { encontrarSuperposicion } from "@/lib/apertura/validaciones";
import { aplicarRegla, revertirRegla, resolverLocalIdDestinos } from "@/lib/apertura/motor";
import type { ReglaVigencia } from "@/lib/apertura/vigencia";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Lanzado dentro del callback de $transaction cuando se detecta superposición
// de vigencia — un return de NextResponse ahí adentro commitearía la
// transacción (sin haber hecho nada) y recién después devolvería el 409, lo
// cual es incorrecto. Throw + catch afuera fuerza el rollback correctamente.
// (Fix de review, ronda 1 — hallazgo TOCTOU en el chequeo de superposición.)
class SuperposicionError extends Error {
  constructor(public reglaId: number) {
    super(`Superposición con la regla existente #${reglaId}`);
  }
}

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

  try {
    const { regla, comprasAfectadas } = await prisma.$transaction(
      async (tx) => {
        // Chequeo de superposición DENTRO de la transacción — hacerlo antes
        // de abrir la transacción permitía que dos requests concurrentes
        // (ej. dos ediciones/creaciones para el mismo entidadId con vigencias
        // superpuestas) pasaran ambos el chequeo (cada uno ve que el otro
        // todavía no commiteó) y terminaran distribuyendo las mismas compras
        // dos veces. (Fix de review, ronda 1.) Se mantiene el filtro
        // NOT: { id } para excluir la regla que se está editando.
        const otras = await tx.reglaApertura.findMany({
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
          throw new SuperposicionError(conflictoId);
        }

        await revertirRegla(tx, id);
        await tx.destinoRegla.deleteMany({ where: { reglaId: id } });

        const destinosResueltos = await resolverLocalIdDestinos(
          tx,
          destinos.map((d) => ({
            localId: d.localId ?? null,
            puntoDeVentaId: d.puntoDeVentaId ?? null,
            porcentaje: d.porcentaje,
          }))
        );

        const regla = await tx.reglaApertura.update({
          where: { id },
          data: {
            modo,
            fechaDesde: vigenciaNueva.fechaDesde,
            fechaHasta: vigenciaNueva.fechaHasta,
            extremosInclusivos,
            destinos: {
              create: destinosResueltos.map((d) => ({
                localId: d.localId,
                puntoDeVentaId: d.puntoDeVentaId,
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
    if (err instanceof SuperposicionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
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
