import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireAuthUser } from "@/lib/auth/require-auth";
import { crearReglaSchema } from "@/lib/apertura/schemas";
import { encontrarSuperposicion } from "@/lib/apertura/validaciones";
import { aplicarRegla } from "@/lib/apertura/motor";
import type { ReglaVigencia } from "@/lib/apertura/vigencia";

export const dynamic = "force-dynamic";
// Motor síncrono, sin cola — mismo criterio que app/api/etl/drive-import/route.ts.
// Ver sección 5 del diseño: riesgo aceptado, se revisita si algún concepto real
// se acerca al límite.
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

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const reglas = await prisma.reglaApertura.findMany({
    include: { destinos: true },
    orderBy: { creadoEn: "desc" },
  });
  return NextResponse.json({ data: reglas });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const parsed = crearReglaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 422 });
  }
  const { entidadId, modo, fechaDesde, fechaHasta, extremosInclusivos, destinos } = parsed.data;

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
        // de abrir la transacción permitía que dos requests concurrentes para
        // el mismo entidadId con vigencias superpuestas pasaran ambos el
        // chequeo (cada uno ve que el otro todavía no commiteó) y terminaran
        // distribuyendo las mismas compras dos veces. (Fix de review, ronda 1.)
        const existentes = await tx.reglaApertura.findMany({
          where: { entidadId, nivel: "concepto", estado: "activa" },
          select: { id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true },
        });
        const conflictoId = encontrarSuperposicion(
          vigenciaNueva,
          existentes.map((r) => ({
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

        const regla = await tx.reglaApertura.create({
          data: {
            nivel: "concepto",
            entidadId,
            modo,
            fechaDesde: vigenciaNueva.fechaDesde,
            fechaHasta: vigenciaNueva.fechaHasta,
            extremosInclusivos,
            creadoPor: user.email ?? user.id,
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
          entidadId,
          vigencia: vigenciaNueva,
          // Number(x.toString()), no Number(x) directo — mismo patrón que pivot usa.
          destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
        });

        return { regla, comprasAfectadas: resultado.comprasAfectadas };
      },
      { timeout: 55000 }
    );

    return NextResponse.json({ data: regla, comprasAfectadas }, { status: 201 });
  } catch (err) {
    if (err instanceof SuperposicionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[POST /api/apertura/reglas]", err);
    return NextResponse.json({ error: "Error interno al crear la regla" }, { status: 500 });
  }
}
