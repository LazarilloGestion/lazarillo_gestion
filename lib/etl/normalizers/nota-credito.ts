// El ERP exporta las notas de crédito electrónicas (NcA/NcB/NcC) con importe
// POSITIVO, mientras que las "NC" clásicas vienen negativas. Una NC siempre
// resta, así que el signo se normaliza acá en vez de confiar en el Excel.
// Se decide solo por el tipo de comprobante en DETALLE — nunca por OBSERVAC,
// donde aparecen falsos positivos ("Pedir Nc por…" en facturas FcA).
const TIPO_NOTA_CREDITO = /^nc[abc]?\s/i;

export function esNotaCredito(detalle: string | null | undefined): boolean {
  return TIPO_NOTA_CREDITO.test((detalle ?? "").trim());
}

// Idempotente: solo invierte un importe positivo, así un NC que ya viene
// negativo (o en 0) no sufre doble inversión si el ERP corrige su exportación.
export function normalizarSignoNotaCredito(detalle: string | null | undefined, importe: string | null): string | null {
  if (importe == null || !esNotaCredito(detalle)) return importe;
  const n = Number(importe);
  if (!(n > 0)) return importe;
  return `-${importe.trim().replace(/^\+/, "")}`;
}
