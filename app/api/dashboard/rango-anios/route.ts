import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";
import { resolveAnioRange } from "@/lib/dashboard/anio-range";

export const dynamic = "force-dynamic";

const getQuerySchema = z.object({
  localId: z.coerce.number().int().optional(),
  puntoDeVentaId: z.coerce.number().int().optional(),
});

interface RangoRow {
  minYear: number | null;
  maxYear: number | null;
}

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    localId: searchParams.get("localId") ?? undefined,
    puntoDeVentaId: searchParams.get("puntoDeVentaId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }
  const { localId, puntoDeVentaId } = parsed.data;

  // Mismo filtro de local/PDV aplicado a las dos tablas; `TRUE` cuando no viene el filtro.
  const localGuard = localId !== undefined ? Prisma.sql`"localId" = ${localId}` : Prisma.sql`TRUE`;
  const pdvGuard =
    puntoDeVentaId !== undefined ? Prisma.sql`"puntoDeVentaId" = ${puntoDeVentaId}` : Prisma.sql`TRUE`;

  try {
    // COALESCE(fechaManual, fecha) en compras — un override manual de fecha puede mover
    // la fila a otro año, igual que en el resto del dashboard (ver query-builders.ts).
    // MIN/MAX directo sobre la fecha (y no sobre EXTRACT(YEAR …) de cada fila): sale de los
    // índices de fecha en vez de recorrer compras + ventas enteras (4 s por carga, 29/10/2026).
    // MIN/MAX y LEAST/GREATEST ignoran los NULL: mismo resultado que antes.
    const [row] = await prisma.$queryRaw<RangoRow[]>(Prisma.sql`
      SELECT EXTRACT(YEAR FROM LEAST(t.c_min, t.v_min))::int    AS "minYear",
             EXTRACT(YEAR FROM GREATEST(t.c_max, t.v_max))::int AS "maxYear"
      FROM (
        SELECT
          (SELECT MIN(COALESCE("fechaManual", fecha)) FROM compras WHERE ${localGuard} AND ${pdvGuard}) AS c_min,
          (SELECT MAX(COALESCE("fechaManual", fecha)) FROM compras WHERE ${localGuard} AND ${pdvGuard}) AS c_max,
          (SELECT MIN(fecha) FROM ventas WHERE ${localGuard} AND ${pdvGuard}) AS v_min,
          (SELECT MAX(fecha) FROM ventas WHERE ${localGuard} AND ${pdvGuard}) AS v_max
      ) t
    `);

    const currentYear = new Date().getFullYear();
    return NextResponse.json(
      resolveAnioRange(row?.minYear ?? null, row?.maxYear ?? null, currentYear),
    );
  } catch (err) {
    console.error("[GET /api/dashboard/rango-anios]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
