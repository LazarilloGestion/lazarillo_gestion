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

// Misma fórmula para el cálculo mensual y para el total (pasando los totales en vez
// de los valores del mes) — Diferencia de caja = Ingresos - Egresos - Ganancia + Flujo de caja.
export function diferenciaCaja(
  ingVal: number | null | undefined,
  egrVal: number | null | undefined,
  gananciaVal: number | null | undefined,
  flujoVal: number | null | undefined,
): number {
  return (ingVal ?? 0) - (egrVal ?? 0) - (gananciaVal ?? 0) + (flujoVal ?? 0);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function lerpColor(fromHex: string, toHex: string, t: number): [number, number, number] {
  const [r1, g1, b1] = hexToRgb(fromHex);
  const [r2, g2, b2] = hexToRgb(toHex);
  return [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t];
}

// Luma perceptual (BT.601) — decide si el texto sobre el fondo va blanco u oscuro.
function luminance([r, g, b]: [number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Interpola un color en un degradé de 3 puntos según `ratio` (0 = stop bajo, 1 = stop alto).
function stopColor(ratio: number, low: string, mid: string, high: string): [number, number, number] {
  const t = Math.min(Math.max(ratio, 0), 1);
  return t <= 0.5 ? lerpColor(low, mid, t / 0.5) : lerpColor(mid, high, (t - 0.5) / 0.5);
}

const HEAT_FILL_STOPS = { low: "#D64545", mid: "#F2C94C", high: "#1F9B59" };
const HEAT_TEXT_STOPS = { low: "#BE423C", mid: "#A8832C", high: "#2E8554" };
const LUMINANCE_THRESHOLD = 150;

// Heatmap de relleno para Ingresos: rojo (mínimo) -> ámbar -> verde (máximo), escala relativa
// por fila. Si min === max (un solo mes visible) no hay forma de ubicar el valor en la escala,
// así que se devuelve el punto medio (ámbar) en vez de forzar un extremo arbitrario.
export function heatmapFill(value: number, min: number, max: number): { background: string; foreground: string } {
  const ratio = min === max ? 0.5 : (value - min) / (max - min);
  const rgb = stopColor(ratio, HEAT_FILL_STOPS.low, HEAT_FILL_STOPS.mid, HEAT_FILL_STOPS.high);
  const foreground = luminance(rgb) < LUMINANCE_THRESHOLD ? "#ffffff" : "#1f1f1d";
  return { background: rgbToHex(rgb), foreground };
}

// Mismo criterio que heatmapFill pero con tonos apagados y solo para colorear texto (sin fondo),
// usado en % Rentabilidad.
export function heatmapText(value: number, min: number, max: number): string {
  const ratio = min === max ? 0.5 : (value - min) / (max - min);
  const rgb = stopColor(ratio, HEAT_TEXT_STOPS.low, HEAT_TEXT_STOPS.mid, HEAT_TEXT_STOPS.high);
  return rgbToHex(rgb);
}

// Acumula diferenciaPorMes en orden ascendente de mes, arrastrando `saldoInicial`
// (saldo heredado de meses/años anteriores). `mesesOrdenados` debe venir ascendente.
export function computeDiferenciaCajaAcumulada(
  mesesOrdenados: number[],
  diferenciaPorMes: Record<number, number>,
  saldoInicial: number,
): Record<number, number> {
  let acc = saldoInicial;
  const result: Record<number, number> = {};
  for (const mes of mesesOrdenados) {
    acc += diferenciaPorMes[mes] ?? 0;
    result[mes] = acc;
  }
  return result;
}
