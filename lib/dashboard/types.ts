export type PivotProveedorRow = {
  level: 2;
  id: string;
  nombre: string;
  proveedorId: number | null;
  conceptoCodigo: string;
  rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
};

export type PivotConceptoRow = {
  level: 1;
  id: string;
  nombre: string;
  conceptoCodigo: string;
  rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotProveedorRow[];
};

export type PivotRubroRow = {
  level: 0;
  id: string;
  nombre: string;
  rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoRow[];
};

export type PivotData = {
  rows: PivotRubroRow[];
  columnTotals: Record<number, number>;
  grandTotal: number;
};

export type DetalleFilter = {
  year: number;
  localId?: number;
  pdvId?: number;
  mes?: number;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
};

// Forma del resultado de la raw query en /api/dashboard/pivot
export type SqlRow = {
  rubro_codigo: string;
  rubro_nombre: string;
  concepto_codigo: string;
  concepto_nombre: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
  // SUM retorna numeric → Prisma lo mapea a Decimal; manejamos ambas formas
  total: { toString(): string } | number | string;
};

// Forma de cada compra devuelta por /api/dashboard/detalle
export type CompraDetalle = {
  rowId: string;
  fecha: string | null;
  importe: unknown; // Decimal serializado como string o number
  proveedor: string | null;
  proveedorRef: { id: number; nombre: string | null; razon: string | null } | null;
  local: { nombre: string } | null;
  puntoDeVenta: { nombre: string } | null;
  conceptoCaja: {
    nombre: string;
    rubro: { nombre: string } | null;
  } | null;
};
