import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { crearReglaSchema } from "@/lib/apertura/schemas";
import { encontrarSuperposicion } from "@/lib/apertura/validaciones";
import { aplicarRegla } from "@/lib/apertura/motor";
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
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = crearReglaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 422 });
  }
  const { entidadId, modo, fechaDesde, fechaHasta, extremosInclusivos, destinos } = parsed.data;

  const existentes = await prisma.reglaApertura.findMany({
    where: { entidadId, nivel: "concepto", estado: "activa" },
    select: { id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true },
  });
  const vigenciaNueva: ReglaVigencia = {
    modo,
    fechaDesde: fechaDesde ? new Date(fechaDesde) : null,
    fechaHasta: fechaHasta ? new Date(fechaHasta) : null,
    extremosInclusivos,
  };
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
    return NextResponse.json({ error: `Superposición con la regla existente #${conflictoId}` }, { status: 409 });
  }

  try {
    const { regla, comprasAfectadas } = await prisma.$transaction(
      async (tx) => {
        const regla = await tx.reglaApertura.create({
          data: {
            nivel: "concepto",
            entidadId,
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
    console.error("[POST /api/apertura/reglas]", err);
    return NextResponse.json({ error: "Error interno al crear la regla" }, { status: 500 });
  }
}
