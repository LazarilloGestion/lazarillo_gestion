import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { parseDashboardParams } from "@/lib/dashboard/params";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import {
  buildComposicion,
  type ComposicionSqlRow,
  type ComposicionOriginalRow,
} from "@/lib/dashboard/apertura-composicion";
import type {
  PivotData,
  PivotRubroRow,
  PivotConceptoRow,
  PivotProveedorRow,
  SqlRow,
  ComposicionMes,
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
    (params.proveedorId !== undefined && isNaN(params.proveedorId)) ||
    (params.observacionQuery !== undefined && params.observacionQuery.length > 256)
  ) {
    return NextResponse.json({ error: "Invalid numeric parameter" }, { status: 400 });
  }

  const { year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, months, vista } = params;
  const visibilidadCol = vista === "resultados" ? "visibleEnResultados" : "visibleEnDashboard";

  try {
  const conditions = buildPivotConditions({ year, tableAlias: "c", localId, pdvId, months, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, filterRubrosOcultos: true, visibilidadCol });
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
      c."distribucionId"                                                  AS distribucion_id,
      TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')         AS fecha,
      COALESCE(c."observacManual", c.observac)                           AS observac,
      (c."importeManual" IS NOT NULL OR c."fechaManual" IS NOT NULL
        OR c."conceptoCodigoManual" IS NOT NULL OR c."observacManual" IS NOT NULL) AS has_manual_override
    FROM v_compras_distribuidas c
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE ${where}
    ORDER BY rubro_nombre NULLS LAST, concepto_nombre NULLS LAST, COALESCE(c."fechaManual", c.fecha) NULLS LAST, proveedor_nombre NULLS LAST
  `);

  // Composición para el tooltip de conceptos aperturados: descompone el importe
  // efectivo por destino (concepto efectivo + mes + destino). Solo la rama
  // distribuida de la vista (`c."distribucionId" IS NOT NULL`). Reusa el mismo
  // `${where}` que el query principal, por lo que necesita el mismo set de
  // LEFT JOIN (cc / rc / p) para que resuelvan sus predicados de rubro,
  // concepto y proveedor.
  const composicionDestinos = await prisma.$queryRaw<ComposicionSqlRow[]>(Prisma.sql`
    SELECT
      COALESCE(cc.codigo, '__sin_concepto')                        AS concepto_codigo,
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int  AS mes,
      COALESCE(pv.nombre, l.nombre, 'Sin destino')                 AS destino_nombre,
      da.porcentaje                                                AS pct,
      SUM(da."importeCalculado")                                   AS importe_calculado
    FROM v_compras_distribuidas c
    JOIN distribuciones_apertura da  ON da.id = c."distribucionId"
    JOIN destinos_regla dr           ON dr.id = da."destinoId"
    LEFT JOIN locales l              ON l.id = dr."localId"
    LEFT JOIN puntos_de_venta pv     ON pv.id = dr."puntoDeVentaId"
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE c."distribucionId" IS NOT NULL AND ${where}
    GROUP BY concepto_codigo, mes, destino_nombre, da.porcentaje
  `);

  // Total "100%" del tooltip = importe original de la compra, deduplicado por
  // compra: en el fan-out de la vista `importeOriginal` se repite en cada fila
  // de destino, así que primero un SELECT DISTINCT por (concepto, mes, compra)
  // y recién después el SUM.
  const composicionOriginales = await prisma.$queryRaw<ComposicionOriginalRow[]>(Prisma.sql`
    SELECT concepto_codigo, mes, SUM(importe_original) AS importe_original
    FROM (
      SELECT DISTINCT
        COALESCE(cc.codigo, '__sin_concepto')                       AS concepto_codigo,
        EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
        da."compraRowId",
        da."importeOriginal"                                        AS importe_original
      FROM v_compras_distribuidas c
      JOIN distribuciones_apertura da  ON da.id = c."distribucionId"
      LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
      LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
      WHERE c."distribucionId" IS NOT NULL AND ${where}
    ) dedup
    GROUP BY concepto_codigo, mes
  `);

  const composicion = buildComposicion(composicionDestinos, composicionOriginales);

  return NextResponse.json(buildPivotData(rows, composicion));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function buildPivotData(
  sqlRows: SqlRow[],
  composicion: Record<string, Record<number, ComposicionMes>>,
): PivotData {
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
      distribucion_id,
      fecha,
      observac,
      has_manual_override,
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
        composicion: composicion[concepto_codigo],
      };
      conceptoMap.set(concKey, concepto);
      rubro.children.push(concepto);
    }
    const concepto = conceptoMap.get(concKey)!;

    const provRow: PivotProveedorRow = {
      level: 2,
      id: `${concKey}|${row_id}|${distribucion_id ?? "orig"}`,
      rowId: row_id,
      distribucionId: distribucion_id,
      nombre: proveedor_nombre,
      fecha: fecha ?? null,
      observac: observac ?? null,
      importe: t,
      proveedorId: proveedor_id,
      conceptoCodigo: concepto_codigo,
      rubroCodigo: rubro_codigo,
      hasManualOverride: !!has_manual_override,
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
