import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { parseDashboardParams } from "@/lib/dashboard/params";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import {
  buildComposicion,
  buildComposicionPorProveedor,
  type ComposicionSqlRow,
  type ComposicionOriginalRow,
} from "@/lib/dashboard/apertura-composicion";
import { buildPivotDataByProveedor } from "@/lib/dashboard/pivot-por-proveedor";
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

  const { year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, months, vista, agrupacion } = params;
  const visibilidadCol = vista === "resultados" ? "visibleEnResultados" : "visibleEnDashboard";

  try {
  const conditions = buildPivotConditions({ year, tableAlias: "c", localId, pdvId, months, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, filterRubrosOcultos: true, visibilidadCol });
  const where = Prisma.join(conditions, " AND ");

  // La composición del tooltip SIEMPRE muestra el reparto completo, aunque el
  // dashboard tenga un filtro de local/PDV activo (spec §1.1 y §8). En la rama
  // distribuida de `v_compras_distribuidas`, `c."localId"` / `c."puntoDeVentaId"`
  // son el local/PDV DESTINO, no el origen de la compra: filtrar la composición
  // por esos predicados dejaría una lista de destinos parcial contra el total
  // "100%" (importe original) que sigue completo. Por eso se reconstruyen las
  // condiciones omitiendo localId/pdvId (los únicos predicados de origen que
  // agrega buildPivotConditions, ambos bajo `if (localId)` / `if (pdvId)`) y se
  // conservan el resto (año, meses, rubro, concepto, proveedor, observación,
  // visibilidad) que sí acotan legítimamente qué conceptos/filas se muestran.
  //
  // Pero tirar localId/pdvId por completo también tira el único scoping por
  // NEGOCIO de origen que había — y conceptoCodigo puede colisionar entre
  // negocios (ver docs Alta Nuñez-Comercio), así que sin ese scoping la
  // composición terminaba sumando compras de otro negocio con el mismo
  // código de concepto y mes. Se filtra en cambio por
  // `"localIdOrigen"`/`"puntoDeVentaIdOrigen"` (el local/PDV real donde se
  // cargó la compra, agregados a la vista en la migración
  // 20260916131712_v_compras_distribuidas_origen) para acotar por negocio de
  // origen sin volver a acotar por destino.
  const conditionsComposicion = buildPivotConditions({ year, tableAlias: "c", localId: undefined, pdvId: undefined, months, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, filterRubrosOcultos: true, visibilidadCol });
  if (localId) conditionsComposicion.push(Prisma.sql`c."localIdOrigen" = ${localId}`);
  if (pdvId) conditionsComposicion.push(Prisma.sql`c."puntoDeVentaIdOrigen" = ${pdvId}`);
  const whereComposicion = Prisma.join(conditionsComposicion, " AND ");

  const rowsQuery = prisma.$queryRaw<SqlRow[]>(Prisma.sql`
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
        OR c."conceptoCodigoManual" IS NOT NULL OR c."observacManual" IS NOT NULL) AS has_manual_override,
      c."localIdOrigen"          AS local_id_origen,
      c."puntoDeVentaIdOrigen"   AS punto_de_venta_id_origen
    FROM v_compras_distribuidas c
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE ${where}
    ORDER BY rubro_nombre NULLS LAST, concepto_nombre NULLS LAST, COALESCE(c."fechaManual", c.fecha) NULLS LAST, proveedor_nombre NULLS LAST
  `);

  // Composición para el tooltip de conceptos aperturados: descompone el importe
  // efectivo por destino (concepto efectivo + mes + destino). Solo la rama
  // distribuida de la vista (`c."distribucionId" IS NOT NULL`). Usa
  // `${whereComposicion}` (sin el filtro de local/PDV del dashboard — ver
  // comentario arriba), por lo que necesita el mismo set de LEFT JOIN
  // (cc / rc / p) que el query principal para resolver sus predicados de rubro,
  // concepto y proveedor.
  const composicionDestinosQuery = prisma.$queryRaw<ComposicionSqlRow[]>(Prisma.sql`
    SELECT
      COALESCE(cc.codigo, '__sin_concepto')                        AS concepto_codigo,
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int  AS mes,
      -- PDV calificado por su local ("Local — PDV"): los nombres de PDV se
      -- repiten entre locales, el PDV a secas es ambiguo (ver describirOrigen).
      CASE
        WHEN pv.nombre IS NOT NULL THEN COALESCE(l.nombre || ' — ', '') || pv.nombre
        ELSE COALESCE(l.nombre, 'Sin destino')
      END                                                         AS destino_nombre,
      p.id                                                          AS proveedor_id,
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
    WHERE c."distribucionId" IS NOT NULL AND ${whereComposicion}
    GROUP BY concepto_codigo, proveedor_id, mes, destino_nombre, da.porcentaje
  `);

  // Total "100%" del tooltip = importe original de la compra, deduplicado por
  // compra: en el fan-out de la vista `importeOriginal` se repite en cada fila
  // de destino, así que primero un SELECT DISTINCT por (concepto, mes, compra)
  // y recién después el SUM.
  const composicionOriginalesQuery = prisma.$queryRaw<ComposicionOriginalRow[]>(Prisma.sql`
    SELECT concepto_codigo, proveedor_id, mes, SUM(importe_original) AS importe_original
    FROM (
      SELECT DISTINCT
        COALESCE(cc.codigo, '__sin_concepto')                       AS concepto_codigo,
        p.id                                                          AS proveedor_id,
        EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
        da."compraRowId",
        da."importeOriginal"                                        AS importe_original
      FROM v_compras_distribuidas c
      JOIN distribuciones_apertura da  ON da.id = c."distribucionId"
      LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
      LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
      WHERE c."distribucionId" IS NOT NULL AND ${whereComposicion}
    ) dedup
    GROUP BY concepto_codigo, proveedor_id, mes
  `);

  // Los tres queries son independientes entre sí y `prisma` es un cliente
  // pooleado — se corren en paralelo para no triplicar la latencia de cada
  // carga del dashboard.
  const [rows, composicionDestinos, composicionOriginales] = await Promise.all([
    rowsQuery,
    composicionDestinosQuery,
    composicionOriginalesQuery,
  ]);

  if (agrupacion === "proveedor") {
    const composicionPorProveedor = buildComposicionPorProveedor(composicionDestinos, composicionOriginales);
    return NextResponse.json(buildPivotDataByProveedor(rows, composicionPorProveedor));
  }

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
      local_id_origen,
      punto_de_venta_id_origen,
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
      localIdOrigen: local_id_origen,
      puntoDeVentaIdOrigen: punto_de_venta_id_origen,
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
