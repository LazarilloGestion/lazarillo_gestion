import type {
  DecimalLike, PivotData, PivotRubroRow, PivotConceptoRow, PivotProveedorRow,
  PivotDataPorProveedor, PivotRubroRowPorProveedor, PivotProveedorSubRow, PivotConceptoSubRow, PivotLineaRow,
} from "./types";

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

function getValue(
  row: PivotRubroRow | PivotConceptoRow | PivotProveedorRow | PivotRubroRowPorProveedor | PivotProveedorSubRow | PivotConceptoSubRow | PivotLineaRow,
  col: SortCol
): number {
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

/** Ordena el árbol "por proveedor" — misma lógica que sortPivotRows, sobre los tipos nuevos, con un nivel más (rubro). */
export function sortPivotRowsPorProveedor(
  rows: PivotRubroRowPorProveedor[],
  col: SortCol,
  dir: SortDir
): PivotRubroRowPorProveedor[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...rows]
    .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
    .map((rubro) => ({
      ...rubro,
      children: [...rubro.children]
        .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
        .map((proveedor) => ({
          ...proveedor,
          children: [...proveedor.children]
            .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
            .map((concepto) => ({
              ...concepto,
              children: [...concepto.children].sort(
                (a, b) => factor * (getValue(a, col) - getValue(b, col))
              ),
            })),
        })),
    }));
}

export type FlatRowPorProveedor =
  | { type: "rubroTop"; data: PivotRubroRowPorProveedor }
  | { type: "proveedorSub"; data: PivotProveedorSubRow }
  | { type: "conceptoSub"; data: PivotConceptoSubRow }
  | { type: "linea"; data: PivotLineaRow };

/** Aplana el árbol "por proveedor" respetando expansión — siempre 4 niveles (no hay variante maxDepth como en Ventas). */
export function flattenRowsPorProveedor(
  pivotData: PivotDataPorProveedor,
  expanded: Set<string>
): FlatRowPorProveedor[] {
  const result: FlatRowPorProveedor[] = [];
  for (const rubro of pivotData.rows) {
    result.push({ type: "rubroTop", data: rubro });
    if (!expanded.has(rubro.id)) continue;
    for (const proveedor of rubro.children) {
      result.push({ type: "proveedorSub", data: proveedor });
      if (!expanded.has(proveedor.id)) continue;
      for (const concepto of proveedor.children) {
        result.push({ type: "conceptoSub", data: concepto });
        if (!expanded.has(concepto.id)) continue;
        for (const linea of concepto.children) {
          result.push({ type: "linea", data: linea });
        }
      }
    }
  }
  return result;
}
