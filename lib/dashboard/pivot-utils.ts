import type { DecimalLike, PivotData, PivotRubroRow, PivotConceptoRow, PivotProveedorRow } from "./types";

export function toNumber(v: DecimalLike): number {
  return typeof v === "object" && v !== null ? Number(v.toString()) : Number(v);
}

export type FlatRow =
  | { type: "rubro"; data: PivotRubroRow }
  | { type: "concepto"; data: PivotConceptoRow }
  | { type: "proveedor"; data: PivotProveedorRow };

/**
 * Aplana el árbol pivot respetando el estado de expansión.
 * maxDepth=2: renderiza rubro+concepto (ventas — sin nivel proveedor)
 * maxDepth=3: renderiza rubro+concepto+proveedor (compras)
 */
export function flattenRows(
  pivotData: PivotData,
  expanded: Set<string>,
  maxDepth: 2 | 3
): FlatRow[] {
  const result: FlatRow[] = [];
  for (const rubro of pivotData.rows) {
    result.push({ type: "rubro", data: rubro });
    if (!expanded.has(rubro.id)) continue;
    for (const concepto of rubro.children) {
      result.push({ type: "concepto", data: concepto });
      if (maxDepth < 3 || !expanded.has(concepto.id)) continue;
      for (const prov of concepto.children) {
        result.push({ type: "proveedor", data: prov });
      }
    }
  }
  return result;
}
