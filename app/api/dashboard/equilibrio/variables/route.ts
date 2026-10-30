import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import { fuenteCompras } from "@/lib/dashboard/fuente-compras";
import { cambioValido, type CambioVariable } from "@/lib/dashboard/equilibrio-config";

export const dynamic = "force-dynamic";

const MESES_PROMEDIO = 6;

// GET — configuración de gastos variables del punto de equilibrio (Diego 30/10/2026).
// Con ?anio&mes (mes de referencia, el último cerrado) suma además lo gastado por concepto ese mes y
// el promedio de los 6 meses que terminan en él, con los filtros de la fila Egresos (Económica,
// rubros visibles, local/PDV): es lo que muestra el ⚙ de la fila para ver el antes → después.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const n = (k: string) => { const v = Number(sp.get(k)); return Number.isInteger(v) && v > 0 ? v : undefined; };
  const anio = n("anio"), mes = n("mes"), localId = n("localId"), pdvId = n("pdvId");

  try {
    const variables = await prisma.$queryRaw<{ tipo: string; codigo: string; pct: number }[]>`
      SELECT tipo, TRIM(codigo) AS codigo, pct::float8 AS pct FROM equilibrio_variables ORDER BY tipo, codigo`;
    if (!anio || !mes || mes > 12) return NextResponse.json({ variables });

    const ref = new Date(Date.UTC(anio, mes - 1, 1));
    const desde = new Date(Date.UTC(anio, mes - MESES_PROMEDIO, 1));
    const hasta = new Date(Date.UTC(anio, mes, 1));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const fecha = Prisma.sql`COALESCE(c."fechaManual", c.fecha)`;
    const imp = Prisma.sql`COALESCE(c."importeManual", c.importe)`;
    const cond = Prisma.join(buildPivotConditions({ tableAlias: "c", localId, pdvId, filterRubrosOcultos: true }), " AND ");
    const gastos = await prisma.$queryRaw<{ rubroCodigo: string | null; rubro: string; codigo: string; nombre: string; prom: number; mes: number }[]>(Prisma.sql`
      SELECT TRIM(rc.codigo) AS "rubroCodigo", TRIM(COALESCE(rc.nombre, 'Sin rubro')) AS rubro,
             TRIM(cc.codigo) AS codigo, TRIM(cc.nombre) AS nombre,
             (SUM(${imp}) / ${MESES_PROMEDIO})::float8 AS prom,
             COALESCE(SUM(${imp}) FILTER (WHERE ${fecha} >= ${iso(ref)}::timestamp), 0)::float8 AS mes
      FROM ${fuenteCompras(undefined)} c
      JOIN conceptos_caja cc            ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
      WHERE ${cond} AND ${fecha} >= ${iso(desde)}::timestamp AND ${fecha} < ${iso(hasta)}::timestamp
      GROUP BY 1, 2, 3, 4
      ORDER BY prom DESC`);
    return NextResponse.json({ variables, gastos });
  } catch (err) {
    console.error("[GET /api/dashboard/equilibrio/variables]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT { cambios: [{ tipo, codigo, pct | null }] } — todo junto o nada. pct null = sin marca (hereda
// del rubro, o fijo si es un rubro). Un concepto con 0 queda fijo aunque su rubro sea variable.
export async function PUT(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { cambios?: unknown } | null;
  const cambios = Array.isArray(body?.cambios) ? body.cambios : null;
  if (!cambios || cambios.length === 0 || cambios.length > 500 || !cambios.every(cambioValido)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  const lista = (cambios as CambioVariable[]).map((c) => ({ ...c, codigo: c.codigo.trim() }));

  try {
    // Solo códigos que existen (no se guardan marcas huérfanas).
    const rubros = lista.filter((c) => c.tipo === "rubro").map((c) => c.codigo);
    const conceptos = lista.filter((c) => c.tipo === "concepto").map((c) => c.codigo);
    const [rOk, cOk] = await Promise.all([
      rubros.length ? prisma.$queryRaw<{ c: string }[]>`SELECT TRIM(codigo) AS c FROM rubros_concepto_caja WHERE TRIM(codigo) = ANY(${rubros})` : [],
      conceptos.length ? prisma.$queryRaw<{ c: string }[]>`SELECT TRIM(codigo) AS c FROM conceptos_caja WHERE TRIM(codigo) = ANY(${conceptos})` : [],
    ]);
    const existe = new Set([...rOk.map((r) => `rubro:${r.c}`), ...cOk.map((r) => `concepto:${r.c}`)]);
    const faltan = lista.filter((c) => !existe.has(`${c.tipo}:${c.codigo}`));
    if (faltan.length) return NextResponse.json({ error: `No existe: ${faltan.map((f) => `${f.tipo} ${f.codigo}`).join(", ")}` }, { status: 400 });

    await prisma.$transaction(lista.map((c) => c.pct == null
      ? prisma.$executeRaw`DELETE FROM equilibrio_variables WHERE tipo = ${c.tipo} AND TRIM(codigo) = ${c.codigo}`
      : prisma.$executeRaw`INSERT INTO equilibrio_variables (tipo, codigo, pct) VALUES (${c.tipo}, ${c.codigo}, ${c.pct})
          ON CONFLICT (tipo, codigo) DO UPDATE SET pct = EXCLUDED.pct`));
    return NextResponse.json({ ok: true, guardados: lista.length });
  } catch (err) {
    console.error("[PUT /api/dashboard/equilibrio/variables]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
