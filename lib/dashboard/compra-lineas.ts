import type { SortState } from "@/hooks/use-sort-state";
import type { DetalleCompraLinea } from "./types";

type Num = string | number | null;

function toNum(v: Num): number | null {
  return v == null ? null : Number(v);
}

// TOTALINS del ERP viene sin impuestos. El importe de la fila de compras
// cuadra con TOTALINS + IVATOT + IMPINTTOT (verificado contra la base:
// las percepciones NO entran — sumarlas descuadra).
export function totalLinea(l: DetalleCompraLinea): number | null {
  const partes = [l.totalIns, l.ivaTot, l.impNtTot].map(toNum);
  if (partes.every((p) => p == null)) return null;
  return partes.reduce<number>((acc, p) => acc + (p ?? 0), 0);
}

export function totalComprobante(lineas: DetalleCompraLinea[]): number | null {
  const totales = lineas.map(totalLinea).filter((t): t is number => t != null);
  if (totales.length === 0) return null;
  return totales.reduce((acc, t) => acc + t, 0);
}

type CompraRef = { comprobante: string | null; localId: number | null; codigo: string | null };

// Se busca por comprobante (no por compraId) para mostrar la factura completa
// aunque esté dividida en varias filas de compras — ver el route. El proveedor
// entra en el filtro porque un mismo número de ticket se repite entre
// proveedores distintos (821 comprobantes en producción, 14-oct-2026): sin él
// el modal mezclaba líneas de facturas ajenas.
export function whereLineasDeCompra(compra: CompraRef | null, compraId: string) {
  if (!compra?.comprobante) return { compraId };
  return {
    comprobante: compra.comprobante,
    localId: compra.localId,
    ...(compra.codigo ? { codPro: compra.codigo } : {}),
  };
}

const NUMERIC_KEYS = {
  cantidad: (l: DetalleCompraLinea) => toNum(l.cantidad),
  neto: (l: DetalleCompraLinea) => toNum(l.neto),
  ivaTot: (l: DetalleCompraLinea) => toNum(l.ivaTot),
  impNtTot: (l: DetalleCompraLinea) => toNum(l.impNtTot),
  total: totalLinea,
} as const;

const TEXT_KEYS = {
  codigo: (l: DetalleCompraLinea) => l.codigo,
  nombre: (l: DetalleCompraLinea) => l.nombre,
  medida: (l: DetalleCompraLinea) => l.medida,
  observac: (l: DetalleCompraLinea) => l.observac,
} as const;

// Los vacíos van siempre al final (en asc y en desc) para que no tapen las
// líneas con dato al buscar diferencias.
function compareNullsLast<T>(va: T | null, vb: T | null, dir: "asc" | "desc", cmp: (a: T, b: T) => number): number {
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const r = cmp(va, vb);
  return dir === "asc" ? r : -r;
}

export function sortCompraLineas(a: DetalleCompraLinea, b: DetalleCompraLinea, sort: SortState): number {
  if (!sort) return 0;
  if (sort.key in NUMERIC_KEYS) {
    const get = NUMERIC_KEYS[sort.key as keyof typeof NUMERIC_KEYS];
    return compareNullsLast(get(a), get(b), sort.dir, (x, y) => x - y);
  }
  if (sort.key in TEXT_KEYS) {
    const get = TEXT_KEYS[sort.key as keyof typeof TEXT_KEYS];
    // `numeric: true` para que el código 59 quede antes que el 201.
    return compareNullsLast(get(a), get(b), sort.dir, (x, y) => x.localeCompare(y, "es", { numeric: true }));
  }
  return 0;
}
