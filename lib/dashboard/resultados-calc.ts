// Lógica pura de cálculo para la pantalla Resultados — sin dependencias de React,
// para poder testear la aritmética financiera sin renderizar componentes.

// Acepta coma o punto como separador decimal (formato es-AR: "1234,56" o "1234.56").
// Si hay coma, el punto se interpreta como separador de miles ("1.234,56" -> 1234.56).
export function parseMontoARS(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function pctSobreIngresos(numerador: number, denominador: number): string {
  return denominador > 0 ? `${((numerador / denominador) * 100).toFixed(1)}%` : "—";
}

// Diferencia de caja de un mes independiente (no acumulada): variación de la caja menos el
// resultado societario del mes. null si falta el arqueo (Disponible en caja) del mes actual o
// del mes anterior — sin los dos extremos no hay ΔCaja para comparar, ese mes va en "—", nunca $0.
export function diferenciaCajaMensual(
  disponibleMes: number | null | undefined,
  disponibleMesAnterior: number | null | undefined,
  resultadoOP: number | null | undefined,
  ganancia: number | null | undefined,
): number | null {
  if (disponibleMes == null || disponibleMesAnterior == null) return null;
  const deltaCaja = disponibleMes - disponibleMesAnterior;
  return deltaCaja - ((resultadoOP ?? 0) - (ganancia ?? 0));
}

// Paleta única de la pantalla Resultados — un solo tono por color, reusado tanto para fondos
// (con texto blanco encima, ver FILL_BAND) como para texto plano (Diferencia de caja,
// Societario, % Rentabilidad). El ámbar es amarillo puro (R=G, B=0 → hue 60°, 100% saturado) sin
// respetar el piso de contraste habitual (~1.8:1 sobre blanco, por debajo del mínimo de 3:1 para
// texto — a propósito, ver commit/feedback de color) — priorizando que se vea "amarillo típico".
export const RESULT_COLORS = {
  negative: "#D64545",
  neutral:  "#AAAA00",
  positive: "#159457",
  noData:   "#bdbbb2",
} as const;

// Fondo + texto para el heatmap de Ingresos/Ganancia — los 3 tonos de RESULT_COLORS son
// suficientemente oscuros (luminancia BT.601 < 150) como para llevar siempre texto blanco.
const FILL_BAND = {
  negative: { background: RESULT_COLORS.negative, foreground: "#ffffff" },
  neutral:  { background: RESULT_COLORS.neutral,  foreground: "#ffffff" },
  positive: { background: RESULT_COLORS.positive, foreground: "#ffffff" },
} as const;

// Cuantiza un ratio 0..1 a 3 bandas discretas en vez de un degradé continuo — "que el cuadro
// se entienda de un vistazo, sin colores de más" (criterio explícito del cliente).
function band(ratio: number): "negative" | "neutral" | "positive" {
  return ratio < 1 / 3 ? "negative" : ratio < 2 / 3 ? "neutral" : "positive";
}

// Ratio (0..1) para una escala relativa por fila: 0 = mínimo visible, 1 = máximo visible.
// Si min === max (un solo mes visible) no hay forma de ubicar el valor en la escala, así
// que se devuelve el punto medio (ámbar) en vez de forzar un extremo arbitrario.
function linearRatio(value: number, min: number, max: number): number {
  return min === max ? 0.5 : (value - min) / (max - min);
}

// Ratio (0..1) para una escala anclada en cero: 0 = rojo (más negativo posible en la fila),
// 0.5 = ámbar (valor 0), 1 = verde (más positivo posible en la fila). A diferencia de una escala
// min/max pura, el 0 real de los datos siempre cae en el punto medio — así el mes "más bajo" de
// una fila toda en positivo no se pinta rojo como si fuera pérdida.
function zeroAnchoredRatio(value: number, min: number, max: number): number {
  const floor = Math.min(min, 0);
  const ceil = Math.max(max, 0);
  return value >= 0
    ? ceil > 0 ? 0.5 + 0.5 * Math.min(value / ceil, 1) : 0.5
    : floor < 0 ? 0.5 - 0.5 * Math.min(value / floor, 1) : 0.5;
}

// Heatmap de relleno para Ingresos: rojo (banda baja) -> ámbar -> verde (banda alta), escala
// relativa por fila — ver linearRatio.
export function heatmapFill(value: number, min: number, max: number): { background: string; foreground: string } {
  return FILL_BAND[band(linearRatio(value, min, max))];
}

// Heatmap de relleno anclado en cero, para filas que pueden ser negativas (p.ej. Ganancia).
// Ver zeroAnchoredRatio — rojo solo aparece si el valor es realmente negativo.
export function heatmapFillZeroAnchored(value: number, min: number, max: number): { background: string; foreground: string } {
  return FILL_BAND[band(zeroAnchoredRatio(value, min, max))];
}

// Variante anclada en cero para colorear texto (sin fondo) — usada en % Rentabilidad junto a
// heatmapFillZeroAnchored (p.ej. Ganancia) para que ambas filas coincidan en qué meses pintan rojo.
export function heatmapTextZeroAnchored(value: number, min: number, max: number): string {
  return RESULT_COLORS[band(zeroAnchoredRatio(value, min, max))];
}
