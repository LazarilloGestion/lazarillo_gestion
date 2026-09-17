import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { patchReglaSchema, type NivelRegla } from "@/lib/apertura/schemas";
import { aplicarRegla, liberarComprasReclamables, reaplicarReglasActivas, revertirRegla, resolverLocalIdDestinos, resolverLocalIdOrigen, verificarSinSuperposicion, SuperposicionError } from "@/lib/apertura/motor";
import { resolverVigencia, vigenciaToSql, FECHA_EFECTIVA_COMPRA_SQL, type ReglaVigencia } from "@/lib/apertura/vigencia";

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
  const { modo, fechaDesde, fechaHasta, extremosInclusivos, origenLocalId, origenPuntoDeVentaId, destinos } = parsed.data;
  // la columna DB no tiene enum — nivelReglaSchema ya validó el valor cuando se creó la regla
  const nivelExistente = existente.nivel as NivelRegla;
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

        // excluirId = id de esta misma regla, para no chocar contra su propia
        // vigencia vieja mientras se recalcula. verificarSinSuperposicion usa el
        // shape { localId, puntoDeVentaId }, distinto del resto del motor.
        await verificarSinSuperposicion(
          tx,
          nivelExistente,
          existente.entidadId,
          vigenciaNueva,
          { localId: origen.origenLocalId, puntoDeVentaId: origen.origenPuntoDeVentaId },
          id
        );

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
            origenLocalId: origen.origenLocalId,
            origenPuntoDeVentaId: origen.origenPuntoDeVentaId,
            modo,
            fechaDesde: vigenciaNueva.fechaDesde,
            fechaHasta: vigenciaNueva.fechaHasta,
            extremosInclusivos,
            // Editar reactiva siempre — una regla editada tiene distribuciones
            // vivas recién generadas por aplicarRegla más abajo, así que no
            // puede quedar "inactiva" (invisible para el chequeo de
            // superposición de cualquier regla futura). Sin condicional sobre
            // el estado previo: es semántica del endpoint, no solo de la UI
            // (Fase C, decisión de brainstorming 19-ago-2026).
            estado: "activa",
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

        const condVigencia = resolverVigencia(vigenciaNueva);
        const vigenciaSql = vigenciaToSql(condVigencia, FECHA_EFECTIVA_COMPRA_SQL);
        await liberarComprasReclamables(tx, nivelExistente, existente.entidadId, vigenciaSql, {
          origenLocalId: origen.origenLocalId,
          origenPuntoDeVentaId: origen.origenPuntoDeVentaId,
        });

        const resultado = await aplicarRegla(tx, {
          reglaId: regla.id,
          nivel: nivelExistente,
          entidadId: existente.entidadId,
          vigencia: vigenciaNueva,
          origen: { origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId },
          // Number(x.toString()), no Number(x) directo — mismo patrón que pivot usa.
          destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
        });

        return { regla, comprasAfectadas: resultado.comprasAfectadas };
      },
      { timeout: 55000 }
    );

    // Cascada: la vigencia/origen nuevo pudo dejar afuera compras que la
    // vigencia VIEJA cubría (ej. acotar de "todo el año" a "enero-marzo") —
    // esas quedaron revertidas (esDistribuido = false) por revertirRegla, pero
    // nada las volvió a resolver contra otras reglas activas. La spec pide
    // reevaluar la UNIÓN de compras antes/después, no solo el conjunto nuevo
    // que aplicarRegla ya cubrió arriba. Misma cascada que DELETE, y por la
    // misma razón corre DESPUÉS de la transacción, no dentro: un reaplique
    // amplio no debería compartir el presupuesto de timeout de la transacción
    // de edición.
    const { errores: erroresCascada } = await reaplicarReglasActivas(prisma);
    if (erroresCascada.length > 0) {
      console.error("[PATCH /api/apertura/reglas/[id]] errores en la cascada de reaplicación", erroresCascada);
    }

    return NextResponse.json({ data: regla, comprasAfectadas, erroresCascada });
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

    // Cascada: una regla de menor prioridad puede tener que reclamar las
    // compras que se acaban de liberar (ver Task 4 del plan de motor). Su
    // propio try/catch, separado del de arriba: si la cascada explota (ej.
    // falla de conexión), el borrado ya commiteó — la respuesta no puede decir
    // "Error interno al eliminar la regla" cuando eliminar es justo lo que sí
    // funcionó (hallazgo de la revisión final de rama).
    let erroresCascada: string[] = [];
    try {
      const resultado = await reaplicarReglasActivas(prisma);
      erroresCascada = resultado.errores;
      if (erroresCascada.length > 0) {
        console.error("[DELETE /api/apertura/reglas/[id]] errores en la cascada de reaplicación", erroresCascada);
      }
    } catch (err) {
      console.error("[DELETE /api/apertura/reglas/[id]] la cascada de reaplicación falló por completo (la regla ya se eliminó)", err);
    }

    return NextResponse.json({ ok: true, comprasRevertidas, erroresCascada });
  } catch (err) {
    console.error("[DELETE /api/apertura/reglas/[id]]", err);
    return NextResponse.json({ error: "Error interno al eliminar la regla" }, { status: 500 });
  }
}
