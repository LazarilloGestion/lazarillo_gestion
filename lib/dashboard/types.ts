// Tipo compartido para valores Decimal de Prisma ($queryRaw devuelve Decimal objects)
export type DecimalLike = { toString(): string } | number | string;

// --- Pivot row types (readonly: nunca se mutan después de construcción) ---

export type PivotProveedorRow = {
  readonly level: 2;
  readonly id: string;
  readonly nombre: string;
  readonly fecha: string | null;
  readonly observac: string | null;
  readonly importe: number;
  readonly proveedorId: number | null;
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
};

export type PivotConceptoRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotProveedorRow[];
};

export type PivotRubroRow = {
  readonly level: 0;
  readonly id: string;
  readonly nombre: string;
  readonly rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoRow[];
};

export type PivotData = {
  rows: PivotRubroRow[];
  columnTotals: Record<number, number>;
  grandTotal: number;
};

// --- Filtros de detalle ---

type BaseDashboardFilter = {
  year: number;
  localId?: number;
  pdvId?: number;
  mes?: number;
};

export type DetalleFilter = BaseDashboardFilter & {
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
};

export type VentasDetalleFilter = BaseDashboardFilter & {
  tipoCodigo?: string;
  cobroCodigo?: string;
};

// Respuesta genérica de endpoints de detalle (indica si hay más de 500 registros)
export type DetalleResponse<T> = {
  data: T[];
  hasMore: boolean;
};

// --- Forma del resultado de la raw query en /api/dashboard/pivot ---
export type SqlRow = {
  rubro_codigo: string;
  rubro_nombre: string;
  concepto_codigo: string;
  concepto_nombre: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
  total: DecimalLike;
  row_id: string;
  fecha: string | null;
  observac: string | null;
};

// --- Ventas ---

export type VentasSqlRow = {
  tipo_codigo: string;
  tipo_nombre: string;
  cobro_codigo: string;
  cobro_nombre: string;
  mes: number;
  total: DecimalLike;
};

export type VentaDetalle = {
  rowId: string;
  fecha: string | null;
  importe: string | number | null;
  importeManual: string | number | null;
  tipo: string | null;
  cobro: string | null;
  turno: string | null;
  comprobant: string | null;
  hora: string | null;
  mesa: string | null;
  mozo: string | null;
  total: string | number | null;
  descuento: string | number | null;
  cupon: string | null;
  local: { nombre: string } | null;
  puntoDeVenta: { nombre: string } | null;
};

// --- Forma de cada compra devuelta por /api/dashboard/detalle ---
export type CompraDetalle = {
  rowId: string;
  fecha: string | null;
  importe: string | number | null;
  importeManual: string | number | null;
  fechaManual: string | null;
  conceptoCodigoManual: string | null;
  observacManual: string | null;
  concepto: string | null;
  detalle: string | null;
  observac: string | null;
  proveedor: string | null;
  proveedorRef: { id: number; nombre: string | null; razon: string | null } | null;
  local: { nombre: string } | null;
  puntoDeVenta: { nombre: string } | null;
  conceptoCaja: {
    codigo: string;
    nombre: string;
    rubro: { nombre: string } | null;
  } | null;
  conceptoCajaManual: {
    codigo: string;
    nombre: string;
    rubro: { nombre: string } | null;
  } | null;
};

// --- Línea de detalle_compras devuelta por /api/dashboard/compra-lineas/[compraId] ---
export type DetalleCompraLinea = {
  rowId: string;
  codigo: string | null;
  nombre: string | null;
  cantidad: string | number | null;
  medida: string | null;
  neto: string | number | null;
  totalIns: string | number | null;
  observac: string | null;
};
