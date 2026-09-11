import { SIN_PROVEEDOR_KEY, SIN_PROVEEDOR_NOMBRE } from "./constants";
import type {
  SqlRow,
  ComposicionMes,
  PivotDataPorProveedor,
  PivotProveedorTopRow,
  PivotConceptoSubRow,
  PivotLineaRow,
} from "./types";

// Hermana de buildPivotData (app/api/dashboard/pivot/route.ts): misma fuente
// de filas (SqlRow[], una por línea de compra con rubro/concepto/proveedor ya
// resueltos), pero agrupa Proveedor → Concepto → línea en vez de
// Rubro → Concepto → línea. Ver spec §3.2.
export function buildPivotDataByProveedor(
  sqlRows: SqlRow[],
  composicionPorProveedor: Record<string, Record<number, ComposicionMes>>
): PivotDataPorProveedor {
  const proveedorMap = new Map<string, PivotProveedorTopRow>();
  const conceptoMap = new Map<string, PivotConceptoSubRow>();

  for (const row of sqlRows) {
    const {
      proveedor_id,
      proveedor_nombre,
      concepto_codigo,
      concepto_nombre,
      rubro_codigo,
      mes,
      total,
      row_id,
      distribucion_id,
      fecha,
      observac,
      has_manual_override,
    } = row;

    const t = typeof total === "object" && total !== null ? Number(total.toString()) : Number(total);

    const provKey = proveedor_id != null ? String(proveedor_id) : SIN_PROVEEDOR_KEY;
    const concKey = `${provKey}|${concepto_codigo}`;

    if (!proveedorMap.has(provKey)) {
      proveedorMap.set(provKey, {
        level: 0,
        id: provKey,
        nombre: proveedor_id != null ? proveedor_nombre : SIN_PROVEEDOR_NOMBRE,
        proveedorId: proveedor_id,
        values: {},
        rowTotal: 0,
        children: [],
      });
    }
    const proveedor = proveedorMap.get(provKey)!;

    if (!conceptoMap.has(concKey)) {
      const concepto: PivotConceptoSubRow = {
        level: 1,
        id: concKey,
        nombre: concepto_nombre,
        conceptoCodigo: concepto_codigo,
        rubroCodigo: rubro_codigo,
        proveedorId: proveedor_id,
        values: {},
        rowTotal: 0,
        children: [],
        composicion: composicionPorProveedor[`${concepto_codigo}|${provKey}`],
      };
      conceptoMap.set(concKey, concepto);
      proveedor.children.push(concepto);
    }
    const concepto = conceptoMap.get(concKey)!;

    const linea: PivotLineaRow = {
      level: 2,
      id: `${concKey}|${row_id}|${distribucion_id ?? "orig"}`,
      rowId: row_id,
      distribucionId: distribucion_id,
      conceptoCodigo: concepto_codigo,
      fecha: fecha ?? null,
      observac: observac ?? null,
      importe: t,
      hasManualOverride: !!has_manual_override,
      values: { [mes]: t },
      rowTotal: t,
    };
    concepto.children.push(linea);
  }

  // Roll up bottom-up: línea → concepto → proveedor (mismo patrón que buildPivotData).
  for (const [, proveedor] of proveedorMap) {
    for (const concepto of proveedor.children) {
      for (const linea of concepto.children) {
        for (const [m, val] of Object.entries(linea.values)) {
          const mn = Number(m);
          concepto.values[mn] = (concepto.values[mn] ?? 0) + val;
        }
        concepto.rowTotal += linea.rowTotal;
      }
      for (const [m, val] of Object.entries(concepto.values)) {
        const mn = Number(m);
        proveedor.values[mn] = (proveedor.values[mn] ?? 0) + val;
      }
      proveedor.rowTotal += concepto.rowTotal;
    }
  }

  const columnTotals: Record<number, number> = {};
  let grandTotal = 0;
  for (const [, proveedor] of proveedorMap) {
    for (const [m, val] of Object.entries(proveedor.values)) {
      const mn = Number(m);
      columnTotals[mn] = (columnTotals[mn] ?? 0) + val;
    }
    grandTotal += proveedor.rowTotal;
  }

  return { rows: Array.from(proveedorMap.values()), columnTotals, grandTotal };
}
