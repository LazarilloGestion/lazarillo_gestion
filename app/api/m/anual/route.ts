import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import { fuenteCompras } from "@/lib/dashboard/fuente-compras";

export const dynamic = "force-dynamic";

// GET ?localId&pdvId&anio — el año mes a mes para el celu (Diego 28/10/2026: promedios
// anuales): ventas y gastos por rubro de cada mes, con los mismos filtros que /api/m/resumen.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const n = (k: string) => { const v = Number(sp.get(k)); return Number.isInteger(v) && v > 0 ? v : undefined; };
  const localId = n("localId"), pdvId = n("pdvId"), anio = n("anio");
  if (!anio) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  try {
    const condV = Prisma.join(buildPivotConditions({ year: anio, tableAlias: "v", hasFechaManual: false, localId, pdvId }), " AND ");
    const condC = Prisma.join(buildPivotConditions({ year: anio, tableAlias: "c", localId, pdvId, filterRubrosOcultos: true }), " AND ");
    const [ventas, rubros] = await Promise.all([
      prisma.$queryRaw<{ mes: number; total: number | null }[]>(Prisma.sql`
        SELECT EXTRACT(MONTH FROM v.fecha)::int AS mes, SUM(COALESCE(v."importeManual", v.importe))::float8 AS total
        FROM ventas v WHERE ${condV} GROUP BY 1`),
      prisma.$queryRaw<{ mes: number; rubro: string; total: number }[]>(Prisma.sql`
        SELECT EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
               COALESCE(rc.nombre, 'Sin Rubro') AS rubro, SUM(COALESCE(c."importeManual", c.importe))::float8 AS total
        FROM ${fuenteCompras(undefined)} c
        LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
        LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
        WHERE ${condC}
        GROUP BY 1, 2`),
    ]);
    const meses = Array.from({ length: 12 }, (_, i) => {
      const lista = rubros.filter((r) => r.mes === i + 1).map((r) => ({ rubro: r.rubro.trim(), total: Number(r.total) })).filter((r) => Math.abs(r.total) > 0.5);
      return { mes: i + 1, ventas: Number(ventas.find((v) => v.mes === i + 1)?.total ?? 0), gastos: lista.reduce((s, r) => s + r.total, 0), rubros: lista };
    });
    return NextResponse.json({ anio, meses });
  } catch (err) {
    console.error("[GET /api/m/anual]", err);
    return NextResponse.json({ error: "No se pudo leer el año." }, { status: 500 });
  }
}
