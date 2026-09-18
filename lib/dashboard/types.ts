// Tipo compartido para valores Decimal de Prisma ($queryRaw devuelve Decimal objects)
export type DecimalLike = { toString(): string } | number | string;

export type ComposicionMes = {
  total: number;
  destinos: { nombre: string; pct: number; importe: number }[];
};

// Shape de la respuesta de GET /api/config/rubros-dashboard — usado por RubrosConfigModal.
export type RubroVisibilidad = {
  codigo: string;
  nombre: string;
  visible: boolean;
};

// --- Pivot row types (readonly: nunca se mutan después de construcción) ---

export type PivotProveedorRow = {
  readonly level: 2;
  readonly id: string;
  readonly rowId: string;
  readonly distribucionId: number | null;
  readonly nombre: string;
  readonly fecha: string | null;
  readonly observac: string | null;
  readonly importe: number;
  readonly proveedorId: number | null;
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;
  readonly hasManualOverride: boolean;
  readonly localIdOrigen: number | null;
  readonly puntoDeVentaIdOrigen: number | null;
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
  composicion?: Record<number, ComposicionMes>;
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

// --- Pivot row types "por proveedor" (Proveedor → Concepto → línea) ---
// Tipos paralelos a PivotRubroRow/PivotConceptoRow/PivotProveedorRow de
// arriba, no reutilizados: forzar otro significado en `rubroCodigo` (p. ej.
// guardar ahí un proveedorId) sería confuso. Es la 2ª repetición de este
// patrón de árbol de 3 niveles — si aparece una 3ª forma de agrupar, ahí sí
// vale la pena generalizar (ver docs/superpowers/specs/2026-09-11-vista-compras-por-proveedor-design.md §3.1).

export type PivotLineaRow = {
  readonly level: 2;
  readonly id: string;
  readonly rowId: string;
  readonly distribucionId: number | null;
  readonly conceptoCodigo: string;
  readonly fecha: string | null;
  readonly observac: string | null;
  readonly importe: number;
  readonly hasManualOverride: boolean;
  readonly localIdOrigen: number | null;
  readonly puntoDeVentaIdOrigen: number | null;
  values: Record<number, number>;
  rowTotal: number;
};

export type PivotConceptoSubRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;
  readonly proveedorId: number | null;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotLineaRow[];
  composicion?: Record<number, ComposicionMes>;
};

export type PivotProveedorTopRow = {
  readonly level: 0;
  readonly id: string;
  readonly nombre: string;
  readonly proveedorId: number | null;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoSubRow[];
};

export type PivotDataPorProveedor = {
  rows: PivotProveedorTopRow[];
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
  rowId?: string;
  distribucionId?: number;
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
  distribucion_id: number | null;
  fecha: string | null;
  observac: string | null;
  has_manual_override: boolean;
  local_id_origen: number | null;
  punto_de_venta_id_origen: number | null;
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
  distribucionId: number | null;
  esDistribuido: boolean;
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
  // Origen real de la compra (distinto de localId/puntoDeVentaId cuando la fila
  // es el destino de una distribución) — necesario para abrir una regla de
  // apertura nivel-registro con el origen correcto (ver commit 05e4c3b).
  localIdOrigen: number | null;
  puntoDeVentaIdOrigen: number | null;
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
