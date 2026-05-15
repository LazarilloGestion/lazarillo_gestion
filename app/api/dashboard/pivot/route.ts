import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type {
  PivotData,
  PivotRubroRow,
  PivotConceptoRow,
  PivotProveedorRow,
} from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

type SqlRow = {
  rubro_codigo: string;
  rubro_nombre: string;
  concepto_codigo: string;
  concepto_nombre: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
  total: number;
};

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const localId = searchParams.get("localId") ? Number(searchParams.get("localId")) : null;
  const pdvId = searchParams.get("pdvId") ? Number(searchParams.get("pdvId")) : null;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`EXTRACT(YEAR FROM c.fecha) = ${year}`,
    Prisma.sql`c.fecha IS NOT NULL`,
    Prisma.sql`c.importe IS NOT NULL`,
  ];
  if (localId) conditions.push(Prisma.sql`c."localId" = ${localId}`);
  if (pdvId) conditions.push(Prisma.sql`c."puntoDeVentaId" = ${pdvId}`);

  const where = Prisma.join(conditions, " AND ");

  const rows = await prisma.$queryRaw<SqlRow[]>(Prisma.sql`
    SELECT
      COALESCE(rc.codigo, '__sin_rubro')                          AS rubro_codigo,
      COALESCE(rc.nombre, 'Sin Rubro')                           AS rubro_nombre,
      COALESCE(cc.codigo, '__sin_concepto')                      AS concepto_codigo,
      COALESCE(cc.nombre, 'Sin Concepto')                        AS concepto_nombre,
      p.id                                                        AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor') AS proveedor_nombre,
      EXTRACT(MONTH FROM c.fecha)::int                           AS mes,
      SUM(c.importe)::float                                      AS total
    FROM compras c
    LEFT JOIN conceptos_caja cc       ON c."conceptoCodigo" = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE ${where}
    GROUP BY rc.codigo, rc.nombre, cc.codigo, cc.nombre, p.id, p.nombre, p.razon, c.proveedor, mes
    ORDER BY rubro_nombre NULLS LAST, concepto_nombre NULLS LAST, proveedor_nombre NULLS LAST, mes
  `);

  return NextResponse.json(buildPivotData(rows));
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
    } = row;

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

    let provRow = concepto.children.find((p) => p.id === provRowId);
    if (!provRow) {
      provRow = {
        level: 2,
        id: provRowId,
        nombre: proveedor_nombre,
        proveedorId: proveedor_id,
        conceptoCodigo: concepto_codigo,
        rubroCodigo: rubro_codigo,
        values: {},
        rowTotal: 0,
      };
      concepto.children.push(provRow);
    }

    const t = Number(total);
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
