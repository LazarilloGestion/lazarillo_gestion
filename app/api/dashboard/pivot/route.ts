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
  const conditions = buildPivotConditions({ year, tableAlias: "c", localId, pdvId, months, rubroCodigo, conceptoCodigo, proveedorId });
  const where = Prisma.join(conditions, " AND ");

  // SUM devuelve numeric (Prisma.Decimal) — no castear a float para evitar drift.
  const rows = await prisma.$queryRaw<SqlRow[]>(Prisma.sql`
    SELECT
      COALESCE(rc.codigo, '__sin_rubro')                          AS rubro_codigo,
      COALESCE(rc.nombre, 'Sin Rubro')                           AS rubro_nombre,
      COALESCE(cc.codigo, '__sin_concepto')                      AS concepto_codigo,
      COALESCE(cc.nombre, 'Sin Concepto')                        AS concepto_nombre,
      p.id                                                        AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor') AS proveedor_nombre,
      EXTRACT(MONTH FROM c.fecha)::int                           AS mes,
      SUM(COALESCE(c."importeManual", c.importe))                AS total
    FROM compras c
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE ${where}
    GROUP BY rc.codigo, rc.nombre, cc.codigo, cc.nombre, p.id, p.nombre, p.razon, c.proveedor, mes
    ORDER BY rubro_nombre NULLS LAST, concepto_nombre NULLS LAST, proveedor_nombre NULLS LAST, mes
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
  // Map por proveedor dentro de cada concepto para O(1) lookup
  const provRowMap = new Map<string, PivotProveedorRow>();

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
    } = row;

    // Convertir Decimal/string a number preservando precisión
    const t = typeof total === "object" && total !== null
      ? Number(total.toString())
      : Number(total);

    const provKey = proveedor_id != null ? String(proveedor_id) : "__sin_prov";
    const concKey = `${rubro_codigo}|${concepto_codigo}`;
    const provRowId = `${concKey}|${provKey}`;

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
    const rubro = rubroMap.get(rubro_codigo);
    if (!rubro) throw new Error(`Rubro ${rubro_codigo} not found in map`);

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
    const concepto = conceptoMap.get(concKey);
    if (!concepto) throw new Error(`Concepto ${concKey} not found in map`);

    if (!provRowMap.has(provRowId)) {
      const provRow: PivotProveedorRow = {
        level: 2,
        id: provRowId,
        nombre: proveedor_nombre,
        proveedorId: proveedor_id,
        conceptoCodigo: concepto_codigo,
        rubroCodigo: rubro_codigo,
        values: {},
        rowTotal: 0,
      };
      provRowMap.set(provRowId, provRow);
      concepto.children.push(provRow);
    }
    const provRow = provRowMap.get(provRowId);
    if (!provRow) throw new Error(`ProvRow ${provRowId} not found in map`);

    provRow.values[mes] = (provRow.values[mes] ?? 0) + t;
    provRow.rowTotal += t;
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
