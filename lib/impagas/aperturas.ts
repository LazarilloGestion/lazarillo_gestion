// Aperturas entre PDV en la vista Impagas (lógica pura, la usan el modal y la API).
//
// Cuando un gasto de un PDV se apertura a otro, el PDV destino le debe su % al
// PDV origen: el origen administra el fondo (pagó al proveedor, sueldos,
// impuestos) y es a quien hay que pagarle. No importa si el origen ya le pagó
// al proveedor. Cada "movimiento" es una fila de compras aperturada al destino.
// Los pagos al PDV origen se registran en Lazarillo y quedan imputados a
// movimientos concretos (aplicaciones): "Saldar" imputa el saldo entero de los
// elegidos; un pago libre se imputa a lo más viejo primero, el último puede
// quedar parcial y lo que sobra queda a cuenta.

export interface MovimientoApertura {
  key: string;            // compras.rowId
  fecha: string;          // YYYY-MM-DD
  comprobante: string | null;
  proveedor: string;
  concepto: string;
  porcentaje: number;
  importe: number;        // parte del destino
  aplicado: number;       // pagos al origen imputados a este movimiento
  esEmpleado?: boolean;   // sueldo / adelanto de un empleado (nombre completo desde la nómina)
}

export interface PagoInterno {
  id: number;
  fecha: string;
  importe: number;
  medio: string;
  referencia: string | null;
  aplicado: number;
  movimientos: number;
}

export interface DeudaConPdv {
  pdvOrigenId: number;
  movimientos: MovimientoApertura[];
  pagos: PagoInterno[];
}

export const MEDIOS_PAGO_INTERNO = ["Transferencia", "Caja Mayor", "Bancos"] as const;
export type MedioPagoInterno = (typeof MEDIOS_PAGO_INTERNO)[number];

export const saldoMov = (m: Pick<MovimientoApertura, "importe" | "aplicado">) =>
  Math.max(0, m.importe - m.aplicado);

export function ordenarMovimientos<T extends { fecha: string; key: string }>(l: T[]): T[] {
  return [...l].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.key.localeCompare(b.key));
}

// Imputa un importe a lo más viejo primero. Devuelve las aplicaciones y lo que sobra (a cuenta).
export function imputarFifo(
  movs: Pick<MovimientoApertura, "key" | "fecha" | "importe" | "aplicado">[],
  importe: number
): { aplicaciones: { key: string; importe: number }[]; sobrante: number } {
  let resto = redondear(importe);
  const aplicaciones: { key: string; importe: number }[] = [];
  for (const m of ordenarMovimientos(movs)) {
    if (resto <= 0) break;
    const s = redondear(saldoMov(m));
    if (s <= 0) continue;
    const a = Math.min(s, resto);
    aplicaciones.push({ key: m.key, importe: a });
    resto = redondear(resto - a);
  }
  return { aplicaciones, sobrante: resto };
}

export const redondear = (n: number) => Math.round(n * 100) / 100;

export const aCuenta = (d: Pick<DeudaConPdv, "pagos">) =>
  redondear(d.pagos.reduce((s, p) => s + Math.max(0, p.importe - p.aplicado), 0));

export const saldoDeuda = (d: DeudaConPdv) =>
  redondear(Math.max(0, d.movimientos.reduce((s, m) => s + saldoMov(m), 0) - aCuenta(d)));

export interface MesDeuda { mes: string; movimientos: MovimientoApertura[]; total: number; saldo: number }

// Para mostrar: el mes más nuevo primero y, adentro, el movimiento más nuevo primero.
export function porMes(movs: MovimientoApertura[]): MesDeuda[] {
  const m = new Map<string, MovimientoApertura[]>();
  for (const x of ordenarMovimientos(movs).reverse()) {
    const k = x.fecha.slice(0, 7);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return [...m.entries()].map(([mes, l]) => ({
    mes, movimientos: l,
    total: redondear(l.reduce((s, x) => s + x.importe, 0)),
    saldo: redondear(l.reduce((s, x) => s + saldoMov(x), 0)),
  }));
}

// ID de transferencia: alfanumérico, sin espacios, hasta 100 caracteres (los
// bancos usan IDs largos, p. ej. 25). Se guarda tal cual, en mayúsculas.
export function normalizarReferencia(raw: string): string | null {
  const v = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{1,100}$/.test(v) ? v : null;
}

// ── Importe en formato moneda (es-AR): "$ 1.234.567,89" ──────────────────────
export function parsearImporteAR(t: string): number | null {
  const limpio = t.replace(/[^\d,]/g, "");
  if (!limpio) return null;
  const [ent, dec = ""] = limpio.split(",");
  const n = Number(`${ent || "0"}.${dec.slice(0, 2) || "0"}`);
  return Number.isFinite(n) ? n : null;
}

// Formatea mientras se tipea: miles con punto, coma decimal (máx. 2 decimales).
export function formatearImporteAR(t: string): string {
  const limpio = t.replace(/[^\d,]/g, "");
  if (!limpio) return "";
  const i = limpio.indexOf(",");
  const ent = (i >= 0 ? limpio.slice(0, i) : limpio).replace(/^0+(?=\d)/, "");
  const dec = i >= 0 ? "," + limpio.slice(i + 1).replace(/,/g, "").slice(0, 2) : "";
  return "$ " + (ent || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".") + dec;
}

export const importeAInput = (n: number) =>
  formatearImporteAR(redondear(n).toFixed(2).replace(".", ",").replace(/,00$/, ""));
