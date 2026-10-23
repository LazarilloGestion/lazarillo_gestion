// Estado de pago de un comprobante del 14 cruzado con el informe 80.
// Puro (sin Prisma): lo usan el semáforo de Detalle de compras y la cuenta
// corriente del proveedor.

export type EstadoPago = "paga" | "parcial" | "impaga" | "auto" | "nc" | "sin-datos";

export interface DatosEstado {
  comprobante: string | null;
  fecha: string | null;     // YYYY-MM-DD (fecha del comprobante)
  total: number;
  pagado: number;
  pagoAutomatico?: boolean;
}

// null = no lleva estado (sin comprobante, o número interno E/G de un gasto
// vario: en MaxiRest se carga siempre con su pago).
export function estadoPago(d: DatosEstado, desdeCobertura: string): EstadoPago | null {
  const c = d.comprobante?.trim().toUpperCase();
  if (!c || c.startsWith("E") || c.startsWith("G")) return null;
  if (c.startsWith("N")) return "nc";
  if (d.fecha && d.fecha < desdeCobertura && Math.abs(d.pagado) < 0.5) return "sin-datos";
  const saldo = d.total - d.pagado;
  if (Math.abs(d.pagado) > 0.5 && Math.abs(saldo) <= 1) return "paga";
  if (Math.abs(d.pagado) > 0.5) return "parcial";
  if (Math.abs(d.total) <= 1) return "paga";
  return d.pagoAutomatico ? "auto" : "impaga";
}

export const ETIQUETA_ESTADO: Record<EstadoPago, string> = {
  paga: "Paga",
  parcial: "Parcial",
  impaga: "Impaga",
  auto: "Pago automático",
  nc: "Nota de crédito",
  "sin-datos": "Sin datos de pago",
};

// Color del punto del semáforo (Tailwind).
export const PUNTO_ESTADO: Record<EstadoPago, string> = {
  paga: "bg-zinc-300 dark:bg-zinc-600",
  parcial: "bg-amber-500",
  impaga: "bg-red-600",
  auto: "bg-zinc-300 dark:bg-zinc-600",
  nc: "bg-sky-400",
  "sin-datos": "bg-transparent border border-zinc-300 dark:border-zinc-600",
};

export const CHIP_ESTADO: Record<EstadoPago, string> = {
  paga: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  parcial: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  impaga: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  auto: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  nc: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  "sin-datos": "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

// Clave de comprobante dentro de un PDV (en el 14 una factura viene en varias filas).
export const claveComprobante = (pdvId: number | null, comprobante: string | null, codigo: string | null) =>
  pdvId != null && comprobante && codigo ? `${pdvId}|${comprobante}|${codigo}` : null;

export interface PeriodoCtaCte { modo: "anio" | "todo"; anio: number }

export function filtrarPorPeriodo<T extends { fecha: string }>(l: T[], p: PeriodoCtaCte): T[] {
  return p.modo === "todo" ? l : l.filter((f) => f.fecha.startsWith(String(p.anio)));
}

// Totales de la cuenta corriente: el saldo cuenta solo lo que es deuda real.
export function totalesCtaCte(l: { total: number; pagado: number; estado: EstadoPago | null }[]) {
  let total = 0, pagado = 0, saldo = 0, impagas = 0;
  for (const f of l) {
    total += f.total;
    pagado += f.pagado;
    if (f.estado === "impaga" || f.estado === "parcial") { saldo += f.total - f.pagado; impagas++; }
  }
  return { total, pagado, saldo, impagas };
}
