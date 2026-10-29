// Tocar un mes vacío de un concepto en el Panel abre la carga de Gasto Vario ya armada
// (Diego 29/10/2026): período = ese mes, el concepto, el importe del último mes anterior con
// gasto (marcado para revisar) y la fecha de pago corrida al mismo día del mes nuevo.

const p2 = (n: number) => String(n).padStart(2, "0");

/** Último mes anterior a `mes` (mismo año) con importe, o null. */
export function mesAnteriorConValor(values: Record<number, number | undefined>, mes: number): { mes: number; importe: number } | null {
  for (let m = mes - 1; m >= 1; m--) {
    const v = values[m];
    if (v != null && Math.abs(v) > 0.5) return { mes: m, importe: Math.round(v * 100) / 100 };
  }
  return null;
}

/** La fecha de pago del gasto anterior corrida tantos meses como van del mes anterior al nuevo (mismo día, tope fin de mes). */
export function correrFecha(iso: string | null | undefined, meses: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const t = Number(m[1]) * 12 + Number(m[2]) - 1 + meses;
  const y = Math.floor(t / 12), mo = (t % 12) + 1;
  const ult = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${p2(mo)}-${p2(Math.min(Number(m[3]), ult))}`;
}

export interface PedidoCarga { anio: number; mes: number; conceptoCodigo: string; conceptoNombre: string; prev: { mes: number; importe: number } | null; filtroPrev: Record<string, unknown> | null }

/** ctx del modal de carga (modo vario). */
export function ctxDesdeCelda(p: PedidoCarga, fechaPagoPrev: string | null) {
  const periodo = `${p.anio}-${p2(p.mes)}`;
  return {
    modo: "vario" as const,
    conceptoCodigo: p.conceptoCodigo,
    periodo,
    importe: p.prev?.importe ?? 0,
    importeAnterior: p.prev ? `${p.anio}-${p2(p.prev.mes)}` : null,
    fechaPago: p.prev ? correrFecha(fechaPagoPrev, p.mes - p.prev.mes) : null,
  };
}
