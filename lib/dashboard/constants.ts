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

// Rubro cuyos "proveedores" suelen ser en realidad personas de planilla con
// nombres ambiguos (ej. "Alejo" vs "Alejo Rodrigo", dos "Abril" con código
// distinto) — ahí se antepone el código de proveedor al nombre en la vista
// Compras x Proveedor. Ver docs/superpowers/specs/
// 2026-09-28-codigo-empleado-proveedor-design.md §2.3.
export const RUBRO_GASTOS_EN_PERSONAL_CODIGO = "3";

// Campo booleano de RubroConceptoCaja que controla si un rubro se ve en cada vista del dashboard.
// Única fuente de verdad — no redeclarar este union en otros archivos.
export const VISIBILIDAD_FIELDS = ["visibleEnDashboard", "visibleEnResultados"] as const;
export type VisibilidadField = typeof VISIBILIDAD_FIELDS[number];

// "Sin Rubro" no es fila de rubros_concepto_caja, su toggle vive en sin_rubro_config. Estos defaults
// copian los de las columnas de los rubros reales y se usan si esa fila no existe (nunca ocultar en silencio).
export const SIN_RUBRO_VISIBILIDAD_DEFAULT: Record<VisibilidadField, boolean> = {
  visibleEnDashboard: true,
  visibleEnResultados: false,
};

// Tope de filas del modal de detalle de compras. Un año completo sin filtro de rubro puede superar
// el tope viejo (2000); por encima de este, el modal avisa (hasMore) en vez de cortar callado.
export const DETALLE_COMPRAS_LIMITE = 5000;

// Mismo criterio para el modal de detalle de ventas: antes cortaba en 2000 sin avisar.
export const DETALLE_VENTAS_LIMITE = 5000;
