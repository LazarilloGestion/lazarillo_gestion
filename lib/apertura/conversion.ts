// Conversión %↔$ del campo bidireccional de cada destino en el modal de
// apertura de gastos (Fase C, apertura-destino-row.tsx) — puro, sin acceso a
// DB/red, 100% testeable. Mismo redondeo a 2 decimales que calcularDistribuciones
// (./calculo.ts) — no es un cálculo autoritativo (eso lo hace el motor al
// guardar), solo la previsualización que ve el usuario mientras arma la regla.

export function montoDesdePct(pct: number, total: number): number {
  return Math.round(pct * total) / 100;
}

export function pctDesdeMonto(monto: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((monto / total) * 10000) / 100;
}
