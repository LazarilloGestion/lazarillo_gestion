import type { DecimalLike, PivotData, PivotRubroRow, PivotConceptoRow, PivotProveedorRow } from "./types";

export function toNumber(v: DecimalLike): number {
  return typeof v === "object" && v !== null ? Number(v.toString()) : Number(v);
}

export const EPSILON = 0.01;

export function hasValue(v: number | undefined): boolean {
  return (v ?? 0) > EPSILON;
}

export type FlatRow =
  | { type: "rubro"; data: PivotRubroRow }
  | { type: "concepto"; data: PivotConceptoRow }
  | { type: "proveedor"; data: PivotProveedorRow };

export type SortCol = number | "total";
export type SortDir = "asc" | "desc";

function getValue(row: PivotRubroRow | PivotConceptoRow | PivotProveedorRow, col: SortCol): number {
  return col === "total" ? row.rowTotal : (row.values[col as number] ?? 0);
}

/** Ordena cada nivel del árbol pivot sin mutar el original. */
export function sortPivotRows(
  rows: PivotRubroRow[],
  col: SortCol,
  dir: SortDir
): PivotRubroRow[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...rows]
    .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
    .map((rubro) => ({
      ...rubro,
      children: [...rubro.children]
        .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
        .map((concepto) => ({
          ...concepto,
          children: [...concepto.children].sort(
            (a, b) => factor * (getValue(a, col) - getValue(b, col))
          ),
        })),
    }));
}

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
