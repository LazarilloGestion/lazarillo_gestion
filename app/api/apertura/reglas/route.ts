import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireAuthUser } from "@/lib/auth/require-auth";
import { crearReglaSchema } from "@/lib/apertura/schemas";
import { aplicarRegla, resolverLocalIdDestinos, resolverLocalIdOrigen, verificarSinSuperposicion, SuperposicionError } from "@/lib/apertura/motor";
import type { ReglaVigencia } from "@/lib/apertura/vigencia";

export const dynamic = "force-dynamic";
// Motor síncrono, sin cola — mismo criterio que app/api/etl/drive-import/route.ts.
// Ver sección 5 del diseño: riesgo aceptado, se revisita si algún concepto real
// se acerca al límite.
export const maxDuration = 60;

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
  const { entidadId, modo, fechaDesde, fechaHasta, extremosInclusivos, origenLocalId, origenPuntoDeVentaId, destinos } =
    parsed.data;

  const vigenciaNueva: ReglaVigencia = {
    modo,
    fechaDesde: fechaDesde ? new Date(fechaDesde) : null,
    fechaHasta: fechaHasta ? new Date(fechaHasta) : null,
    extremosInclusivos,
  };

  try {
    const { regla, comprasAfectadas } = await prisma.$transaction(
      async (tx) => {
        // Si vino solo puntoDeVentaId, completa origenLocalId antes de chequear
        // superposición y persistir — el filtro del motor usa origenLocalId
        // para el caso "todo el local".
        const origen = await resolverLocalIdOrigen(tx, {
          origenLocalId: origenLocalId ?? null,
          origenPuntoDeVentaId: origenPuntoDeVentaId ?? null,
        });

        // verificarSinSuperposicion usa el shape { localId, puntoDeVentaId },
        // distinto del { origenLocalId, origenPuntoDeVentaId } del resto del motor.
        await verificarSinSuperposicion(tx, entidadId, vigenciaNueva, {
          localId: origen.origenLocalId,
          puntoDeVentaId: origen.origenPuntoDeVentaId,
        });

        const destinosResueltos = await resolverLocalIdDestinos(
          tx,
          destinos.map((d) => ({
            localId: d.localId ?? null,
            puntoDeVentaId: d.puntoDeVentaId ?? null,
            porcentaje: d.porcentaje,
          }))
        );

        const regla = await tx.reglaApertura.create({
          data: {
            nivel: "concepto",
            entidadId,
            origenLocalId: origen.origenLocalId,
            origenPuntoDeVentaId: origen.origenPuntoDeVentaId,
            modo,
            fechaDesde: vigenciaNueva.fechaDesde,
            fechaHasta: vigenciaNueva.fechaHasta,
            extremosInclusivos,
            creadoPor: user.email ?? user.id,
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
          entidadId,
          vigencia: vigenciaNueva,
          origen: { origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId },
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
