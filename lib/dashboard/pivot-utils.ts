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

// Velocidad (Diego 27/10): abrir un concepto con ~1.500 registros tardaba ~1 s en
// dibujarse. Se muestran de a TANDA_PIVOT y una fila "mas" ofrece ver el resto.
// Totales, celdas y búsqueda siguen sobre todos los registros (vienen del servidor).
export const TANDA_PIVOT = 100;
export type FilaMas = { id: string; conceptoId: string; mostrados: number; total: number };

export type FlatRow =
  | { type: "rubro"; data: PivotRubroRow }
  | { type: "concepto"; data: PivotConceptoRow }
  | { type: "proveedor"; data: PivotProveedorRow }
  | { type: "mas"; data: FilaMas };

export type SortCol = number | "total";
export type SortDir = "asc" | "desc";

type SortableRow =
  | PivotRubroRow | PivotConceptoRow | PivotProveedorRow
  | PivotRubroRowPorProveedor | PivotProveedorSubRow | PivotConceptoSubRow | PivotLineaRow;

function getValue(row: SortableRow, col: SortCol): number {
  return col === "total" ? row.rowTotal : (row.values[col as number] ?? 0);
}

/** Compara por valor y, ante empate, desempata alfabéticamente por nombre (PivotLineaRow no tiene nombre y queda sin desempate). */
function compareRows(a: SortableRow, b: SortableRow, col: SortCol, factor: number): number {
  const diff = getValue(a, col) - getValue(b, col);
  if (diff !== 0) return factor * diff;
  const nombreA = "nombre" in a ? a.nombre : "";
  const nombreB = "nombre" in b ? b.nombre : "";
  return nombreA.localeCompare(nombreB, "es", { sensitivity: "base" });
}

/** Ordena cada nivel del árbol pivot sin mutar el original. */
export function sortPivotRows(
  rows: PivotRubroRow[],
  col: SortCol,
  dir: SortDir
): PivotRubroRow[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...rows]
    .sort((a, b) => compareRows(a, b, col, factor))
    .map((rubro) => ({
      ...rubro,
      children: [...rubro.children]
        .sort((a, b) => compareRows(a, b, col, factor))
        .map((concepto) => ({
          ...concepto,
          children: [...concepto.children].sort(
            (a, b) => compareRows(a, b, col, factor)
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
  maxDepth: 2 | 3,
  // Cuántos registros mostrar por concepto (id → cantidad). Sin mapa: todos.
  mostrar?: Map<string, number>
): FlatRow[] {
  const result: FlatRow[] = [];
  for (const rubro of pivotData.rows) {
    result.push({ type: "rubro", data: rubro });
    if (!expanded.has(rubro.id)) continue;
    for (const concepto of rubro.children) {
      result.push({ type: "concepto", data: concepto });
      if (maxDepth < 3 || !expanded.has(concepto.id)) continue;
      const tope = mostrar ? (mostrar.get(concepto.id) ?? TANDA_PIVOT) : Infinity;
      const hijos = concepto.children.length > tope ? concepto.children.slice(0, tope) : concepto.children;
      for (const prov of hijos) {
        result.push({ type: "proveedor", data: prov });
      }
      if (hijos.length < concepto.children.length) {
        result.push({
          type: "mas",
          data: { id: `${concepto.id}|mas`, conceptoId: concepto.id, mostrados: hijos.length, total: concepto.children.length },
        });
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
    .sort((a, b) => compareRows(a, b, col, factor))
    .map((rubro) => ({
      ...rubro,
      children: [...rubro.children]
        .sort((a, b) => compareRows(a, b, col, factor))
        .map((proveedor) => ({
          ...proveedor,
          children: [...proveedor.children]
            .sort((a, b) => compareRows(a, b, col, factor))
            .map((concepto) => ({
              ...concepto,
              children: [...concepto.children].sort(
                (a, b) => compareRows(a, b, col, factor)
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
