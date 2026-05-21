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
