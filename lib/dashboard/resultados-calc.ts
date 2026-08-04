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
// de los valores del mes) — Diferencia de caja = Ingresos - Egresos - Ganancia - Flujo de caja.
export function diferenciaCaja(
  ingVal: number | null | undefined,
  egrVal: number | null | undefined,
  gananciaVal: number | null | undefined,
  flujoVal: number | null | undefined,
): number {
  return (ingVal ?? 0) - (egrVal ?? 0) - (gananciaVal ?? 0) - (flujoVal ?? 0);
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
