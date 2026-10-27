import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import { fuenteCompras } from "@/lib/dashboard/fuente-compras";

export const dynamic = "force-dynamic";

// GET ?localId&pdvId&anio&mes — el mes de un vistazo para el celular (Diego 27/10):
// ventas, gastos por rubro y resultado, con los mismos filtros que el Panel
// (Económica, rubros visibles en el panel). Liviano: solo sumas, no el pivot entero.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const n = (k: string) => { const v = Number(sp.get(k)); return Number.isInteger(v) && v > 0 ? v : undefined; };
  const localId = n("localId"), pdvId = n("pdvId"), anio = n("anio"), mes = n("mes");
  if (!anio || !mes || mes > 12) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  try {
    const condV = Prisma.join(buildPivotConditions({ year: anio, tableAlias: "v", hasFechaManual: false, localId, pdvId, months: [mes] }), " AND ");
    const condC = Prisma.join(buildPivotConditions({ year: anio, tableAlias: "c", localId, pdvId, months: [mes], filterRubrosOcultos: true }), " AND ");
    const [ventas, rubros] = await Promise.all([
      prisma.$queryRaw<{ total: number | null }[]>(Prisma.sql`
        SELECT SUM(COALESCE(v."importeManual", v.importe))::float8 AS total FROM ventas v WHERE ${condV}`),
      prisma.$queryRaw<{ rubro: string; total: number }[]>(Prisma.sql`
        SELECT COALESCE(rc.nombre, 'Sin Rubro') AS rubro, SUM(COALESCE(c."importeManual", c.importe))::float8 AS total
        FROM ${fuenteCompras(undefined)} c
        LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
        LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
        WHERE ${condC}
        GROUP BY 1 ORDER BY 2 DESC`),
    ]);
    const v = Number(ventas[0]?.total ?? 0);
    const lista = rubros.map((r) => ({ rubro: r.rubro.trim(), total: Number(r.total) })).filter((r) => Math.abs(r.total) > 0.5);
    const gastos = lista.reduce((s, r) => s + r.total, 0);
    return NextResponse.json({ ventas: v, gastos, resultado: v - gastos, rubros: lista });
  } catch (err) {
    console.error("[GET /api/m/resumen]", err);
    return NextResponse.json({ error: "No se pudo leer el resumen." }, { status: 500 });
  }
}
