export const MONTHS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
] as const;

export const MONTH_IDXS = Array.from({ length: 12 }, (_, i) => i + 1);

// Fallback codes/nombres para registros sin categoría asignada
export const SIN_RUBRO_CODE    = "__sin_rubro";
export const SIN_RUBRO_NOMBRE  = "Sin Rubro";
export const SIN_CONCEPTO_CODE  = "__sin_concepto";
export const SIN_CONCEPTO_NOMBRE = "Sin Concepto";
export const SIN_TIPO_CODE     = "__sin_tipo";
export const SIN_TIPO_NOMBRE   = "Sin Tipo";
export const SIN_COBRO_CODE    = "__sin_cobro";
export const SIN_COBRO_NOMBRE  = "Sin Cobro";

// Campo booleano de RubroConceptoCaja que controla si un rubro se ve en cada vista del dashboard.
// Única fuente de verdad — no redeclarar este union en otros archivos.
export const VISIBILIDAD_FIELDS = ["visibleEnDashboard", "visibleEnResultados"] as const;
export type VisibilidadField = typeof VISIBILIDAD_FIELDS[number];

// Clave sintética para agrupar compras sin proveedor asignado en el árbol
// "por proveedor" — análoga a SIN_RUBRO_CODE/SIN_CONCEPTO_CODE de arriba,
// pero el id de proveedor es numérico (FK nullable), no un código de texto,
// así que no hay valor numérico "mágico" que reusar como con rubro/concepto.
export const SIN_PROVEEDOR_KEY = "__sin_proveedor";

// Label a mostrar para el bucket "sin proveedor" del árbol por proveedor —
// distinto de SIN_PROVEEDOR_KEY (clave de agrupación): la SQL de
// /api/dashboard/pivot cae a c.proveedor (texto crudo del ERP de un proveedor
// SIN vincular) antes de llegar al literal 'Sin Proveedor' cuando proveedor_id
// es null, así que no se puede confiar en proveedor_nombre para este caso.
export const SIN_PROVEEDOR_NOMBRE = "Sin Proveedor";
