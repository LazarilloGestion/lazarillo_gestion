import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { previewTotalQuerySchema } from "@/lib/apertura/schemas";
import { condicionComprasElegibles } from "@/lib/apertura/motor";
import { resolverVigencia, vigenciaToSql, FECHA_EFECTIVA_COMPRA_SQL, type ReglaVigencia } from "@/lib/apertura/vigencia";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = previewTotalQuerySchema.safeParse({
    nivel: searchParams.get("nivel") ?? undefined,
    entidadId: searchParams.get("entidadId") ?? undefined,
    reglaId: searchParams.get("reglaId") ?? undefined,
    origenLocalId: searchParams.get("origenLocalId") ?? undefined,
    origenPuntoDeVentaId: searchParams.get("origenPuntoDeVentaId") ?? undefined,
    modo: searchParams.get("modo") ?? undefined,
    fechaDesde: searchParams.get("fechaDesde") ?? undefined,
    fechaHasta: searchParams.get("fechaHasta") ?? undefined,
    // Ausente en la URL == default true (mismo default que el schema);
    // "false" explícito == false. Se pre-coerciona acá porque los query
    // params siempre llegan como string, nunca como boolean real.
    extremosInclusivos: searchParams.get("extremosInclusivos") !== "false",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 422 });
  }
  const { nivel, entidadId, reglaId, origenLocalId, origenPuntoDeVentaId, modo, fechaDesde, fechaHasta, extremosInclusivos } =
    parsed.data;

  const vigencia: ReglaVigencia = {
    modo,
    fechaDesde: fechaDesde ? new Date(fechaDesde) : null,
    fechaHasta: fechaHasta ? new Date(fechaHasta) : null,
    extremosInclusivos,
  };

  try {
    const cond = resolverVigencia(vigencia);
    const vigenciaSql = vigenciaToSql(cond, FECHA_EFECTIVA_COMPRA_SQL);

    // Dos números con usos distintos en el formulario: `total` (suma de TODO
    // el período elegido) va en el header "Total del período" como contexto
    // agregado; `ultimoValor` (solo el mes más reciente CON compras) es la
    // base que cada destino usa para el %↔$ — un total acumulado de
    // histórico completo (potencialmente años) resultaba un número sin uso
    // práctico para estimar el reparto ahí (pedido del usuario, sesión
    // 21-sep-2026). Un solo CTE evalúa condicionComprasElegibles una vez para
    // ambos. Meses sin compras no generan fila en "elegibles", así que el
    // ORDER BY + LIMIT 1 del último mes ya los saltea solo.
    const rows = await prisma.$queryRaw<{ total: Prisma.Decimal | null; ultimoValor: Prisma.Decimal | null }[]>(
      Prisma.sql`
      WITH elegibles AS (
        ${condicionComprasElegibles(
          nivel,
          entidadId,
          vigenciaSql,
          { origenLocalId: origenLocalId ?? null, origenPuntoDeVentaId: origenPuntoDeVentaId ?? null },
          reglaId ?? null
        )}
      )
      SELECT
        (SELECT COALESCE(SUM("importeBase"), 0) FROM elegibles) AS total,
        (
          SELECT SUM("importeBase") FROM elegibles
          WHERE date_trunc('month', "fechaEfectiva") = (
            SELECT date_trunc('month', "fechaEfectiva") FROM elegibles ORDER BY "fechaEfectiva" DESC LIMIT 1
          )
        ) AS "ultimoValor"
    `
    );

    const total = rows[0]?.total != null ? Number(rows[0].total.toString()) : 0;
    const ultimoValor = rows[0]?.ultimoValor != null ? Number(rows[0].ultimoValor.toString()) : 0;
    return NextResponse.json({ total, ultimoValor });
  } catch (err) {
    console.error("[GET /api/apertura/reglas/preview-total]", err);
    return NextResponse.json({ error: "Error interno al calcular el total" }, { status: 500 });
  }
}
