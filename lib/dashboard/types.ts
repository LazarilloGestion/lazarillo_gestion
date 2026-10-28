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

// --- Pivot row types "por proveedor" (Rubro → Proveedor → Concepto → línea) ---
// Tipos paralelos a PivotRubroRow/PivotConceptoRow/PivotProveedorRow de
// arriba, no reutilizados: forzar otro significado en `rubroCodigo` (p. ej.
// guardar ahí un proveedorId) sería confuso. Ver
// docs/superpowers/specs/2026-09-18-vista-por-proveedor-nivel-rubro-design.md.

export type PivotLineaRow = {
  readonly level: 3;
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
  readonly level: 2;
  readonly id: string;
  readonly nombre: string;
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;
  readonly proveedorId: number | null;
  readonly proveedorTexto: string | null;
  // Mismo campo que PivotProveedorSubRow.codigo, para poder pasar el código
  // al filtro de drill-down (ver DetalleFilter.codigo) — sin esto, clickear
  // el detalle de un concepto bajo un proveedor de texto crudo con código
  // (ej. "368 - Abril") mezclaba las compras de las DOS personas que
  // comparten ese nombre, aunque la fila mostrada ya las separe (hallazgo de
  // la revisión final de rama).
  readonly codigo: string | null;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotLineaRow[];
  composicion?: Record<number, ComposicionMes>;
  composicionTotal?: ComposicionMes;
};

export type PivotProveedorSubRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;
  readonly proveedorId: number | null;
  readonly proveedorTexto: string | null;
  // Código de proveedor del ERP — null sin proveedor real y sin código en la
  // compra. Ver proveedor_codigo en SqlRow.
  readonly codigo: string | null;
  readonly rubroCodigo: string;
  readonly entidadIdProveedor: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoSubRow[];
  composicion?: Record<number, ComposicionMes>;
  composicionTotal?: ComposicionMes;
};

export type PivotRubroRowPorProveedor = {
  readonly level: 0;
  readonly id: string;
  readonly nombre: string;
  readonly rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotProveedorSubRow[];
};

export type PivotDataPorProveedor = {
  rows: PivotRubroRowPorProveedor[];
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
  // Sin proveedorId pero con texto crudo del ERP (Diego, Gabriel, GASTOS
  // VARIOS, etc.) — mutuamente excluyente con proveedorId y sinProveedor.
  proveedorTexto?: string;
  // Código de la compra (Compra.codigo) — SOLO válido junto con
  // proveedorTexto, para acotar el drill-down a una sola persona cuando dos
  // comparten proveedorTexto (ej. dos "Abril" con código 368 y 670). Ausente
  // = no filtra por código (compatibilidad con proveedorTexto sin código).
  codigo?: string;
  // Sin proveedorId NI texto crudo — las compras realmente sin ningún dato de
  // proveedor. Mutuamente excluyente con proveedorId y proveedorTexto.
  sinProveedor?: boolean;
  rowId?: string;
  distribucionId?: number;
  // Búsqueda por contenido en la observación — filtro global del dashboard, para que el modal
  // muestre las mismas compras que suma la celda clickeada.
  observacionQuery?: string;
  // Búsqueda por importe — ídem, filtro global del dashboard (texto tipeado, se parsea en el servidor).
  importeQuery?: string;
  // Selección parcial de meses del dashboard. Se ignora si viene `mes` (la celda de un mes puntual).
  meses?: number[];
  // Toggle Histórico del modal: todos los años (year y mes/meses se ignoran).
  historico?: boolean;
  // Switch del panel: en Financiera el detalle lista los pagos del período.
  modo?: "economica" | "financiera";
  // Vista Insumos: compras que traen ese insumo (código del maestro) / compras sin insumos (van por concepto).
  insumoCodigo?: string;
  sinInsumos?: boolean;
};

export type VentasDetalleFilter = BaseDashboardFilter & {
  tipoCodigo?: string;
  cobroCodigo?: string;
};

// Respuesta genérica de endpoints de detalle. `hasMore` solo lo devuelve el
// detalle de compras cuando corta en DETALLE_COMPRAS_LIMITE; detalle-ventas no lo envía.
export type DetalleResponse<T> = {
  data: T[];
  hasMore?: boolean;
};

// --- Forma del resultado de la raw query en /api/dashboard/pivot ---
export type SqlRow = {
  rubro_codigo: string;
  rubro_nombre: string;
  concepto_codigo: string;
  concepto_nombre: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  // Columna cruda `compras.proveedor` SIN el COALESCE de proveedor_nombre: es
  // la única forma de distinguir "no hay proveedor real pero sí texto del ERP"
  // de "no hay ni proveedor ni texto" (que el COALESCE colapsa al literal
  // 'Sin Proveedor'). La usa el filtro de drill-down, no el agrupado del árbol.
  proveedor_texto_crudo: string | null;
  // Código de proveedor del ERP (columna D del Excel de compras, Compra.codigo)
  // — null cuando no hay proveedor real Y la compra no trae código. Usado para
  // desambiguar nombres ambiguos (ver pivot-table-por-proveedor.tsx) y para la
  // clave de agrupación de proveedores sin proveedorId real (ver
  // pivot-por-proveedor.ts).
  proveedor_codigo: string | null;
  mes: number;
  total: DecimalLike;
  row_id: string;
  distribucion_id: number | null;
  // Vista Financiera: id del pago del 80 (una factura viene en una fila por pago). null en Económica.
  pago_ref?: string | null;
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
  // Total de la compra base. En una fila aperturada `importe` es solo la
  // fracción del destino; este es el valor que el modal de edición corrige.
  importeBase: string | number | null;
  importeManual: string | number | null;
  fechaManual: string | null;
  conceptoCodigoManual: string | null;
  observacManual: string | null;
  concepto: string | null;
  detalle: string | null;
  observac: string | null;
  // Sin observación: los 3 insumos más relevantes del renglón, armado al vuelo (se muestra en gris).
  obsInsumos?: string | null;
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
  // Cuenta corriente / semáforo: comprobante y proveedor (código del ERP) de la
  // compra base, su PDV y el estado de pago (14 cruzado con el informe 80).
  comprobante?: string | null;
  codigoProveedor?: string | null;
  // Fecha e importe con que la fila cuenta en la vista elegida (Financiera: el
  // pago y la parte que cubre; Económica: el período de un sueldo). La edición
  // sigue usando fecha/importe de la compra.
  fechaVista?: string | null;
  importeVista?: string | number | null;
  pagoRef?: string | null;
  // Detalle de compras: "Fecha gasto" (económica) y "Fecha pago" (80 / caja del gasto vario).
  fechaGasto?: string | null;
  fechaPago?: string | null;
  cajaPago?: string | null;
  pdvCompraId?: number | null;
  estadoPago?: { estado: import("@/lib/cta-cte/estado").EstadoPago; total: number; pagado: number; ultimoPago?: string | null; pagos?: number } | null;
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
  ivaTot: string | number | null;
  impNtTot: string | number | null;
  observac: string | null;
};
