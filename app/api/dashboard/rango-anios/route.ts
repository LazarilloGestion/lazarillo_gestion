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
    const [row] = await prisma.$queryRaw<RangoRow[]>(Prisma.sql`
      SELECT MIN(y)::int AS "minYear", MAX(y)::int AS "maxYear"
      FROM (
        SELECT EXTRACT(YEAR FROM COALESCE("fechaManual", fecha))::int AS y
        FROM compras
        WHERE (fecha IS NOT NULL OR "fechaManual" IS NOT NULL) AND ${localGuard} AND ${pdvGuard}
        UNION ALL
        SELECT EXTRACT(YEAR FROM fecha)::int AS y
        FROM ventas
        WHERE fecha IS NOT NULL AND ${localGuard} AND ${pdvGuard}
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
