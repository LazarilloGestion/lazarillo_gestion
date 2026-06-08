import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { parseVentasParams } from "@/lib/dashboard/params";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import { toNumber } from "@/lib/dashboard/pivot-utils";
import {
  SIN_TIPO_CODE, SIN_TIPO_NOMBRE,
  SIN_COBRO_CODE, SIN_COBRO_NOMBRE,
} from "@/lib/dashboard/constants";
import type {
  PivotData,
  PivotRubroRow,
  PivotConceptoRow,
  VentasSqlRow,
} from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const params = parseVentasParams(searchParams);

  if (
    (params.localId !== undefined && isNaN(params.localId)) ||
    (params.pdvId !== undefined && isNaN(params.pdvId))
  ) {
    return NextResponse.json({ error: "Invalid numeric parameter" }, { status: 400 });
  }

  const { year, localId, pdvId, months } = params;

  try {
    const conditions = buildPivotConditions({ year, tableAlias: "v", hasFechaManual: false, localId, pdvId, months });
    const where = Prisma.join(conditions, " AND ");

    const rows = await prisma.$queryRaw<VentasSqlRow[]>(Prisma.sql`
      SELECT
        COALESCE(v.tipo, ${SIN_TIPO_CODE})        AS tipo_codigo,
        COALESCE(v.tipo, ${SIN_TIPO_NOMBRE})       AS tipo_nombre,
        COALESCE(v."codCobro", ${SIN_COBRO_CODE})  AS cobro_codigo,
        COALESCE(v.cobro, ${SIN_COBRO_NOMBRE})     AS cobro_nombre,
        EXTRACT(MONTH FROM v.fecha)::int           AS mes,
        SUM(COALESCE(v."importeManual", v.importe)) AS total
      FROM ventas v
      WHERE ${where}
      GROUP BY v.tipo, v."codCobro", v.cobro, EXTRACT(MONTH FROM v.fecha)::int
      ORDER BY tipo_nombre NULLS LAST, cobro_nombre NULLS LAST, mes
    `);

    return NextResponse.json(buildPivotData(rows));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function buildPivotData(sqlRows: VentasSqlRow[]): PivotData {
  const tipoMap = new Map<string, PivotRubroRow>();
  const cobroMap = new Map<string, PivotConceptoRow>();

  for (const row of sqlRows) {
    const { tipo_codigo, tipo_nombre, cobro_codigo, cobro_nombre, mes } = row;
    const t = toNumber(row.total);
    const cobroKey = `${tipo_codigo}|${cobro_codigo}`;

    if (!tipoMap.has(tipo_codigo)) {
      tipoMap.set(tipo_codigo, {
        level: 0,
        id: tipo_codigo,
        nombre: tipo_nombre,
        rubroCodigo: tipo_codigo,
        values: {},
        rowTotal: 0,
        children: [],
      });
    }
    const tipo = tipoMap.get(tipo_codigo)!;

    if (!cobroMap.has(cobroKey)) {
      const cobroRow: PivotConceptoRow = {
        level: 1,
        id: cobroKey,
        nombre: cobro_nombre,
        conceptoCodigo: cobro_codigo,
        rubroCodigo: tipo_codigo,
        values: {},
        rowTotal: 0,
        children: [],
      };
      cobroMap.set(cobroKey, cobroRow);
      tipo.children.push(cobroRow);
    }
    const cobro = cobroMap.get(cobroKey)!;

    cobro.values[mes] = (cobro.values[mes] ?? 0) + t;
    cobro.rowTotal += t;
  }

  for (const [, tipo] of tipoMap) {
    for (const cobro of tipo.children) {
      for (const [m, val] of Object.entries(cobro.values)) {
        const mn = Number(m);
        tipo.values[mn] = (tipo.values[mn] ?? 0) + val;
      }
      tipo.rowTotal += cobro.rowTotal;
    }
  }

  const columnTotals: Record<number, number> = {};
  let grandTotal = 0;
  for (const [, tipo] of tipoMap) {
    for (const [m, val] of Object.entries(tipo.values)) {
      const mn = Number(m);
      columnTotals[mn] = (columnTotals[mn] ?? 0) + val;
    }
    grandTotal += tipo.rowTotal;
  }

  return { rows: Array.from(tipoMap.values()), columnTotals, grandTotal };
}
