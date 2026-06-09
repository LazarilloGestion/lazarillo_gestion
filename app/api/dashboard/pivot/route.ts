import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { parseDashboardParams } from "@/lib/dashboard/params";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import type {
  PivotData,
  PivotRubroRow,
  PivotConceptoRow,
  PivotProveedorRow,
  SqlRow,
} from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const params = parseDashboardParams(searchParams);

  if (
    (params.localId !== undefined && isNaN(params.localId)) ||
    (params.pdvId !== undefined && isNaN(params.pdvId)) ||
    (params.proveedorId !== undefined && isNaN(params.proveedorId))
  ) {
    return NextResponse.json({ error: "Invalid numeric parameter" }, { status: 400 });
  }

  const { year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, months } = params;

  try {
  const conditions = buildPivotConditions({ year, tableAlias: "c", localId, pdvId, months, rubroCodigo, conceptoCodigo, proveedorId, filterRubrosOcultos: true });
  const where = Prisma.join(conditions, " AND ");

  const rows = await prisma.$queryRaw<SqlRow[]>(Prisma.sql`
    SELECT
      COALESCE(rc.codigo, '__sin_rubro')                                  AS rubro_codigo,
      COALESCE(rc.nombre, 'Sin Rubro')                                   AS rubro_nombre,
      COALESCE(cc.codigo, '__sin_concepto')                              AS concepto_codigo,
      COALESCE(cc.nombre, 'Sin Concepto')                                AS concepto_nombre,
      p.id                                                                AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')         AS proveedor_nombre,
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int        AS mes,
      COALESCE(c."importeManual", c.importe)                             AS total,
      c."rowId"                                                           AS row_id,
      TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')         AS fecha,
      COALESCE(c."observacManual", c.observac)                           AS observac
    FROM compras c
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE ${where}
    ORDER BY rubro_nombre NULLS LAST, concepto_nombre NULLS LAST, COALESCE(c."fechaManual", c.fecha) NULLS LAST, proveedor_nombre NULLS LAST
  `);

  return NextResponse.json(buildPivotData(rows));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function buildPivotData(sqlRows: SqlRow[]): PivotData {
  const rubroMap = new Map<string, PivotRubroRow>();
  const conceptoMap = new Map<string, PivotConceptoRow>();

  for (const row of sqlRows) {
    const {
      rubro_codigo,
      rubro_nombre,
      concepto_codigo,
      concepto_nombre,
      proveedor_id,
      proveedor_nombre,
      mes,
      total,
      row_id,
      fecha,
      observac,
    } = row;

    const t = typeof total === "object" && total !== null
      ? Number(total.toString())
      : Number(total);

    const concKey = `${rubro_codigo}|${concepto_codigo}`;

    if (!rubroMap.has(rubro_codigo)) {
      rubroMap.set(rubro_codigo, {
        level: 0,
        id: rubro_codigo,
        nombre: rubro_nombre,
        rubroCodigo: rubro_codigo,
        values: {},
        rowTotal: 0,
        children: [],
      });
    }
    const rubro = rubroMap.get(rubro_codigo)!;

    if (!conceptoMap.has(concKey)) {
      const concepto: PivotConceptoRow = {
        level: 1,
        id: concKey,
        nombre: concepto_nombre,
        conceptoCodigo: concepto_codigo,
        rubroCodigo: rubro_codigo,
        values: {},
        rowTotal: 0,
        children: [],
      };
      conceptoMap.set(concKey, concepto);
      rubro.children.push(concepto);
    }
    const concepto = conceptoMap.get(concKey)!;

    const provRow: PivotProveedorRow = {
      level: 2,
      id: `${concKey}|${row_id}`,
      nombre: proveedor_nombre,
      fecha: fecha ?? null,
      observac: observac ?? null,
      importe: t,
      proveedorId: proveedor_id,
      conceptoCodigo: concepto_codigo,
      rubroCodigo: rubro_codigo,
      values: { [mes]: t },
      rowTotal: t,
    };
    concepto.children.push(provRow);
  }

  // Roll up values bottom-up: proveedor → concepto → rubro
  for (const [, rubro] of rubroMap) {
    for (const concepto of rubro.children) {
      for (const prov of concepto.children) {
        for (const [m, val] of Object.entries(prov.values)) {
          const mn = Number(m);
          concepto.values[mn] = (concepto.values[mn] ?? 0) + val;
        }
        concepto.rowTotal += prov.rowTotal;
      }
      for (const [m, val] of Object.entries(concepto.values)) {
        const mn = Number(m);
        rubro.values[mn] = (rubro.values[mn] ?? 0) + val;
      }
      rubro.rowTotal += concepto.rowTotal;
    }
  }

  const columnTotals: Record<number, number> = {};
  let grandTotal = 0;
  for (const [, rubro] of rubroMap) {
    for (const [m, val] of Object.entries(rubro.values)) {
      const mn = Number(m);
      columnTotals[mn] = (columnTotals[mn] ?? 0) + val;
    }
    grandTotal += rubro.rowTotal;
  }

  return { rows: Array.from(rubroMap.values()), columnTotals, grandTotal };
}
