export interface AnioRange {
  /** Año más viejo con datos de compras/ventas; null si no hay ninguna fila. */
  minYear: number | null;
  /** Año más nuevo navegable: el año actual siempre alcanzable, o más si el dato lo supera. */
  maxYear: number;
}

/**
 * Deriva el rango de años navegable a partir del mínimo/máximo de fechas ya
 * importadas. El año actual nunca queda fuera del rango, aunque todavía no
 * haya datos cargados para él.
 */
export function resolveAnioRange(
  dataMin: number | null,
  dataMax: number | null,
  currentYear: number,
): AnioRange {
  return {
    minYear: dataMin,
    maxYear: Math.max(dataMax ?? currentYear, currentYear),
  };
}
