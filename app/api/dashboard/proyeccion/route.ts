import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { parseVentasParams } from "@/lib/dashboard/params";
import { buildPivotConditions, rangoAnio } from "@/lib/dashboard/query-builders";
import { toNumber } from "@/lib/dashboard/pivot-utils";
import { proyectarMes, debeProyectar, METODOS, type Metodo } from "@/lib/dashboard/proyeccion";

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
      SELECT to_char(MAX(v.fecha)::date, 'YYYY-MM-DD') AS ultimo
      FROM ventas v
      WHERE ${Prisma.join([...base, rangoAnio(Prisma.sql`v.fecha`, year)], " AND ")}
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
        // Rangos sobre v.fecha (no v.fecha::date) para que use el índice (Diego 29/10/2026).
        Prisma.sql`v.fecha >= ${desde}::timestamp`,
        Prisma.sql`v.fecha < ${ultimo}::date + 1`,
      ], " AND ")}
      GROUP BY 1
      ORDER BY 1
    `);

    // Proyecciones guardadas de este local/PDV (para medir qué método erró menos).
    const ambito = `${localId ?? "*"}/${pdvId ?? "*"}`;
    const guardadas = await prisma.$queryRaw<{ anio: number; mes: number; metodo: Metodo; proyeccion: Prisma.Decimal }[]>(Prisma.sql`
      SELECT anio, mes, metodo, proyeccion FROM proyecciones_ingresos
      WHERE ambito = ${ambito} AND corte >= ${desde}::date
    `).catch((err) => {
      console.error("No se pudieron leer las proyecciones guardadas", err);
      return [];
    });

    const proyeccion = proyectarMes(
      rows.map((r) => ({ fecha: r.fecha, total: toNumber(r.total) })),
      ultimo,
      guardadas.map((g) => ({ anio: g.anio, mes: g.mes, metodo: g.metodo, proyeccion: toNumber(g.proyeccion) })),
    );

    // Se guarda la de hoy (los dos métodos). Mismo corte = se actualiza, no se duplica.
    if (proyeccion) {
      try {
        for (const metodo of METODOS) {
          await prisma.$executeRaw(Prisma.sql`
            INSERT INTO proyecciones_ingresos (ambito, anio, mes, corte, metodo, facturado, proyeccion)
            VALUES (${ambito}, ${proyeccion.anio}, ${proyeccion.mes}, ${ultimo}::date, ${metodo},
                    ${Math.round(proyeccion.facturado * 100) / 100}, ${Math.round(proyeccion.proyecciones[metodo] * 100) / 100})
            ON CONFLICT (ambito, anio, mes, corte, metodo)
            DO UPDATE SET facturado = EXCLUDED.facturado, proyeccion = EXCLUDED.proyeccion, "creadoEn" = now()
          `);
        }
      } catch (err) {
        console.error("No se pudo guardar la proyección", err); // no frena el tooltip
      }
    }
    return NextResponse.json({ proyeccion });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
