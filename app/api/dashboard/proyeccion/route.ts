import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { parseVentasParams } from "@/lib/dashboard/params";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import { toNumber } from "@/lib/dashboard/pivot-utils";
import { proyectarMes, debeProyectar } from "@/lib/dashboard/proyeccion";

export const dynamic = "force-dynamic";

// Proyección de cierre del mes con ventas incompletas (tooltip de Ingresos).
// Mismos filtros que /api/dashboard/pivot-ventas (local/PDV), sin filtro de meses.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { year, localId, pdvId } = parseVentasParams(new URL(request.url).searchParams);

  try {
    const base = buildPivotConditions({ tableAlias: "v", hasFechaManual: false, localId, pdvId });

    const [ult] = await prisma.$queryRaw<{ ultimo: string | null }[]>(Prisma.sql`
      SELECT to_char(MAX(v.fecha::date), 'YYYY-MM-DD') AS ultimo
      FROM ventas v
      WHERE ${Prisma.join([...base, Prisma.sql`EXTRACT(YEAR FROM v.fecha) = ${year}`], " AND ")}
    `);
    const ultimo = ult?.ultimo ?? null;
    // "Hoy" en Argentina (UTC-3).
    const hoy = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
    if (!ultimo || !debeProyectar(ultimo, hoy)) return NextResponse.json({ proyeccion: null });

    // Desde el mismo mes del año anterior (comparación + backtest + ventana de 8 semanas).
    const [uy, um] = ultimo.split("-").map(Number);
    const desde = `${uy - 1}-${String(um).padStart(2, "0")}-01`;

    const rows = await prisma.$queryRaw<{ fecha: string; total: Prisma.Decimal | number }[]>(Prisma.sql`
      SELECT to_char(v.fecha::date, 'YYYY-MM-DD') AS fecha,
             SUM(COALESCE(v."importeManual", v.importe)) AS total
      FROM ventas v
      WHERE ${Prisma.join([
        ...base,
        Prisma.sql`v.fecha::date >= ${desde}::date`,
        Prisma.sql`v.fecha::date <= ${ultimo}::date`,
      ], " AND ")}
      GROUP BY 1
      ORDER BY 1
    `);

    const proyeccion = proyectarMes(rows.map((r) => ({ fecha: r.fecha, total: toNumber(r.total) })), ultimo);
    return NextResponse.json({ proyeccion });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
