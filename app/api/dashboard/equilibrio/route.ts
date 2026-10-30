import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import { fuenteCompras } from "@/lib/dashboard/fuente-compras";

export const dynamic = "force-dynamic";

// GET ?year&localId&pdvId — gastos VARIABLES por mes para el punto de equilibrio (Diego 30/10/2026),
// con los mismos filtros que la fila Egresos del tablero (vista Económica, rubros visibles).
// Variable = importe × % de equilibrio_variables (el del concepto manda sobre el de su rubro).
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const n = (k: string) => { const v = Number(sp.get(k)); return Number.isInteger(v) && v > 0 ? v : undefined; };
  const year = n("year"), localId = n("localId"), pdvId = n("pdvId");
  if (!year) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  try {
    const cond = Prisma.join(buildPivotConditions({ year, tableAlias: "c", localId, pdvId, filterRubrosOcultos: true }), " AND ");
    const filas = await prisma.$queryRaw<{ mes: number; nombre: string; total: number }[]>(Prisma.sql`
      SELECT EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
             TRIM(CASE WHEN vc.pct IS NOT NULL THEN cc.nombre ELSE rc.nombre END) AS nombre,
             SUM(COALESCE(c."importeManual", c.importe) * COALESCE(vc.pct, vr.pct) / 100)::float8 AS total
      FROM ${fuenteCompras(undefined)} c
      LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
      LEFT JOIN equilibrio_variables vc ON vc.tipo = 'concepto' AND vc.codigo = cc.codigo
      LEFT JOIN equilibrio_variables vr ON vr.tipo = 'rubro' AND vr.codigo = rc.codigo
      WHERE ${cond} AND COALESCE(vc.pct, vr.pct) > 0
      GROUP BY 1, 2`);
    const variables = await prisma.$queryRaw<{ tipo: string; nombre: string; pct: number }[]>(Prisma.sql`
      SELECT v.tipo, TRIM(COALESCE(rc.nombre, cc.nombre, v.codigo)) AS nombre, v.pct::float8 AS pct
      FROM equilibrio_variables v
      LEFT JOIN rubros_concepto_caja rc ON v.tipo = 'rubro' AND rc.codigo = v.codigo
      LEFT JOIN conceptos_caja cc       ON v.tipo = 'concepto' AND cc.codigo = v.codigo
      WHERE v.pct > 0 ORDER BY v.tipo DESC, 2`);

    const porMes: Record<number, { total: number; detalle: { nombre: string; total: number }[] }> = {};
    for (const f of filas) {
      const m = (porMes[f.mes] ??= { total: 0, detalle: [] });
      m.total += Number(f.total);
      m.detalle.push({ nombre: f.nombre, total: Number(f.total) });
    }
    for (const m of Object.values(porMes)) m.detalle.sort((a, b) => b.total - a.total);
    return NextResponse.json({ porMes, variables });
  } catch (err) {
    console.error("[GET /api/dashboard/equilibrio]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
