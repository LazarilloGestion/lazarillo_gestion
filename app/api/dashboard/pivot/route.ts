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
import { fuenteCompras } from "@/lib/dashboard/fuente-compras";
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

  const { year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, importeQuery, months, vista, agrupacion, modo } = params;
  // Económica (por fecha de factura) o Financiera (por fecha de pago): ver fuente-compras.ts.
  const fuente = fuenteCompras(modo);
  const visibilidadCol = vista === "resultados" ? "visibleEnResultados" : "visibleEnDashboard";

  try {
  const conditions = buildPivotConditions({ year, tableAlias: "c", localId, pdvId, months, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, importeQuery, filterRubrosOcultos: true, visibilidadCol });
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
  // código de concepto y mes. Se filtra en cambio por `"localIdOrigen"` (el
  // local real donde se cargó la compra, agregado a la vista en la migración
  // 20260916131712_v_compras_distribuidas_origen) para acotar por negocio de
  // origen sin volver a acotar por destino.
  //
  // OJO: solo por localIdOrigen, NUNCA por puntoDeVentaIdOrigen. La colisión
  // de códigos es entre NEGOCIOS (Local, ej. Ramos Mejía vs San Justo — ver
  // docs Alta Nuñez-Comercio), no entre PDVs de un mismo local. Ramos Mejía
  // tiene PDVs Bar y Canchas: si el usuario filtra el dashboard por Canchas
  // (que solo recibe reparto de apertura, nunca origina compras) y acá se
  // filtrara también por puntoDeVentaIdOrigen = Canchas, la composición no
  // encuentra nada (el origen real es Bar) y el tooltip desaparece — bug
  // reportado por el cliente el 19-sep-2026 (luz/gas aperturados desde Bar,
  // sin tooltip al mirar Canchas).
  const conditionsComposicion = buildPivotConditions({ year, tableAlias: "c", localId: undefined, pdvId: undefined, months, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, importeQuery, filterRubrosOcultos: true, visibilidadCol });
  if (localId) conditionsComposicion.push(Prisma.sql`c."localIdOrigen" = ${localId}`);
  const whereComposicion = Prisma.join(conditionsComposicion, " AND ");

  // Vista Insumos (punto 8 de Etapa 3, Diego 26/10): cada gasto por sus insumos
  // (informe 25) y, si no tiene detalle, por su concepto. Los totales dan igual que
  // por Concepto: el importe de la fila se reparte entre sus líneas en proporción a
  // lo que vale cada una. Las líneas SIN unidad de medida son el concepto mismo (así
  // lista MaxiRest una factura cargada por concepto) y van al concepto.
  if (agrupacion === "insumo") {
    const filas = await prisma.$queryRaw<SqlRow[]>(Prisma.sql`
      WITH c AS (
        SELECT
          COALESCE(rc.codigo, '__sin_rubro')                                  AS rubro_codigo,
          COALESCE(rc.nombre, 'Sin Rubro')                                   AS rubro_nombre,
          COALESCE(cc.codigo, '__sin_concepto')                              AS concepto_codigo,
          COALESCE(cc.nombre, 'Sin Concepto')                                AS concepto_nombre,
          p.id                                                                AS proveedor_id,
          COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')         AS proveedor_nombre,
          c.proveedor                                                        AS proveedor_texto_crudo,
          c.codigo                                                           AS proveedor_codigo,
          EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int        AS mes,
          COALESCE(c."importeManual", c.importe)                             AS total,
          c."rowId"                                                           AS row_id,
          c."distribucionId"                                                  AS distribucion_id,
          c."pagoRef"                                                         AS pago_ref,
          TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')         AS fecha,
          COALESCE(c."observacManual", c.observac)                           AS observac,
          (c."importeManual" IS NOT NULL OR c."fechaManual" IS NOT NULL
            OR c."conceptoCodigoManual" IS NOT NULL OR c."observacManual" IS NOT NULL) AS has_manual_override,
          c."localIdOrigen"          AS local_id_origen,
          c."puntoDeVentaIdOrigen"   AS punto_de_venta_id_origen,
          co.comprobante, co.codigo AS cod_pro, co."localId" AS lid, co."codCga" AS cga
        FROM ${fuente} c
        JOIN compras co                   ON co."rowId" = c."rowId"
        LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
        LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
        LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
        WHERE ${where}
      ),
      l AS (
        SELECT d.comprobante, d."codPro", d."localId", d."codCga",
          CASE WHEN NULLIF(TRIM(d.medida), '') IS NULL THEN NULL ELSE d.codigo END AS ins,
          MAX(d.nombre) AS nombre,
          SUM(COALESCE(d."totalIns", 0) + COALESCE(d."ivaTot", 0) + COALESCE(d."impNtTot", 0)) AS w
        FROM detalle_compras d
        WHERE EXISTS (SELECT 1 FROM c WHERE c.comprobante = d.comprobante AND c.cod_pro = d."codPro" AND c.lid = d."localId" AND c.cga = d."codCga")
        GROUP BY 1, 2, 3, 4, 5
      ),
      lt AS (
        SELECT comprobante, "codPro", "localId", "codCga", SUM(w) AS wt,
          BOOL_OR(ins IS NOT NULL) AS con_insumo
        FROM l GROUP BY 1, 2, 3, 4
      )
      -- Filas con insumos: una por línea, con su parte del importe.
      SELECT c.rubro_codigo, c.rubro_nombre,
        CASE WHEN l.ins IS NULL THEN c.concepto_codigo ELSE 'ins:' || l.ins END AS concepto_codigo,
        CASE WHEN l.ins IS NULL THEN c.concepto_nombre ELSE l.nombre END        AS concepto_nombre,
        c.proveedor_id, c.proveedor_nombre, c.proveedor_texto_crudo, c.proveedor_codigo, c.mes,
        c.total * l.w / lt.wt AS total,
        c.row_id, c.distribucion_id,
        COALESCE(c.pago_ref, '') || '|' || COALESCE(l.ins, 'c') AS pago_ref,
        c.fecha, c.observac, c.has_manual_override, c.local_id_origen, c.punto_de_venta_id_origen
      FROM c
      JOIN lt ON lt.comprobante = c.comprobante AND lt."codPro" = c.cod_pro AND lt."localId" = c.lid AND lt."codCga" = c.cga
      JOIN l  ON l.comprobante = c.comprobante AND l."codPro" = c.cod_pro AND l."localId" = c.lid AND l."codCga" = c.cga
      WHERE lt.con_insumo AND lt.wt <> 0
      UNION ALL
      -- Sin insumos: por su concepto, como en la vista por Concepto.
      SELECT c.rubro_codigo, c.rubro_nombre, c.concepto_codigo, c.concepto_nombre,
        c.proveedor_id, c.proveedor_nombre, c.proveedor_texto_crudo, c.proveedor_codigo, c.mes,
        c.total, c.row_id, c.distribucion_id, c.pago_ref,
        c.fecha, c.observac, c.has_manual_override, c.local_id_origen, c.punto_de_venta_id_origen
      FROM c
      WHERE NOT EXISTS (
        SELECT 1 FROM lt
        WHERE lt.comprobante = c.comprobante AND lt."codPro" = c.cod_pro AND lt."localId" = c.lid AND lt."codCga" = c.cga
          AND lt.con_insumo AND lt.wt <> 0
      )
      ORDER BY rubro_nombre NULLS LAST, concepto_nombre NULLS LAST, fecha NULLS LAST, proveedor_nombre NULLS LAST
    `);
    return NextResponse.json(buildPivotData(filas, {}));
  }

  const rowsQuery = prisma.$queryRaw<SqlRow[]>(Prisma.sql`
    SELECT
      COALESCE(rc.codigo, '__sin_rubro')                                  AS rubro_codigo,
      COALESCE(rc.nombre, 'Sin Rubro')                                   AS rubro_nombre,
      COALESCE(cc.codigo, '__sin_concepto')                              AS concepto_codigo,
      COALESCE(cc.nombre, 'Sin Concepto')                                AS concepto_nombre,
      p.id                                                                AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')         AS proveedor_nombre,
      c.proveedor                                                        AS proveedor_texto_crudo,
      c.codigo                                                           AS proveedor_codigo,
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int        AS mes,
      COALESCE(c."importeManual", c.importe)                             AS total,
      c."rowId"                                                           AS row_id,
      c."distribucionId"                                                  AS distribucion_id,
      c."pagoRef"                                                         AS pago_ref,
      TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')         AS fecha,
      COALESCE(c."observacManual", c.observac)                           AS observac,
      (c."importeManual" IS NOT NULL OR c."fechaManual" IS NOT NULL
        OR c."conceptoCodigoManual" IS NOT NULL OR c."observacManual" IS NOT NULL) AS has_manual_override,
      c."localIdOrigen"          AS local_id_origen,
      c."puntoDeVentaIdOrigen"   AS punto_de_venta_id_origen
    FROM ${fuente} c
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
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')   AS proveedor_nombre,
      c.codigo                                                     AS proveedor_codigo,
      da.porcentaje                                                AS pct,
      SUM(da."importeCalculado")                                   AS importe_calculado
    FROM ${fuente} c
    JOIN distribuciones_apertura da  ON da.id = c."distribucionId"
    JOIN destinos_regla dr           ON dr.id = da."destinoId"
    LEFT JOIN locales l              ON l.id = dr."localId"
    LEFT JOIN puntos_de_venta pv     ON pv.id = dr."puntoDeVentaId"
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE c."distribucionId" IS NOT NULL AND ${whereComposicion}
    GROUP BY concepto_codigo, proveedor_id, proveedor_nombre, proveedor_codigo, mes, destino_nombre, da.porcentaje
  `);

  // Total "100%" del tooltip = importe original de la compra, deduplicado por
  // compra: en el fan-out de la vista `importeOriginal` se repite en cada fila
  // de destino, así que primero un SELECT DISTINCT por (concepto, mes, compra)
  // y recién después el SUM.
  const composicionOriginalesQuery = prisma.$queryRaw<ComposicionOriginalRow[]>(Prisma.sql`
    SELECT concepto_codigo, proveedor_id, proveedor_nombre, proveedor_codigo, mes, SUM(importe_original) AS importe_original
    FROM (
      SELECT DISTINCT
        COALESCE(cc.codigo, '__sin_concepto')                       AS concepto_codigo,
        p.id                                                          AS proveedor_id,
        COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')   AS proveedor_nombre,
        c.codigo                                                     AS proveedor_codigo,
        EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
        da."compraRowId",
        da."importeOriginal"                                        AS importe_original
      FROM ${fuente} c
      JOIN distribuciones_apertura da  ON da.id = c."distribucionId"
      LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
      LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
      WHERE c."distribucionId" IS NOT NULL AND ${whereComposicion}
    ) dedup
    GROUP BY concepto_codigo, proveedor_id, proveedor_nombre, proveedor_codigo, mes
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
      pago_ref,
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
      // En Financiera una factura puede venir en varias filas (una por pago).
      id: `${concKey}|${row_id}|${distribucion_id ?? "orig"}${pago_ref ? `|${pago_ref}` : ""}`,
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
