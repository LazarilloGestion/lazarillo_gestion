// Vista Impagas: lógica pura (sin Prisma) — la usa el modal en el navegador.
//
// Un comprobante es "impago" si su total (el del informe 80 si existe, si no
// la suma del 14) menos lo pagado según el 80 no da cero. De esos, algunos
// quedan en la pestaña Excluidas por un MOTIVO:
//   - nc:    nota de crédito (no es algo a pagar; resta deuda).
//   - rubro: toda la factura (sin contar percepciones) es de rubros apagados en
//            "Rubros visibles en panel" — p. ej. Iva compensación.
//   - auto:  el proveedor está marcado "pago automático" (débito, retención).
// "Pasar a impagas" (forzada) le gana a cualquier motivo.

import type { DeudaConPdv } from "./aperturas";

export interface PagoDet {
  fecha: string; // YYYY-MM-DD
  importe: number;
  medio: string | null;
  orden?: string | null; // número de orden de pago en MaxiRest (informe 80)
}

export interface ComprobanteImpago {
  id: string; // `${pdvId}|${comprobante}|${codPro}`
  pdvId: number;
  comprobante: string;
  codPro: string;
  proveedor: string;
  proveedorId: number | null;
  fecha: string; // YYYY-MM-DD (fecha de la factura)
  total: number;
  pagado: number;
  rubroOculto: string | null; // nombre/s de los rubros ocultos que la excluyen
  pagoAutomatico: boolean;
  forzada: boolean;
  conceptos: string;
  pagos: PagoDet[];
}

export interface ImpagasResponse {
  desde: string; // YYYY-MM-DD: desde cuándo se cuentan (filtro "Desde" del modal)
  data: ComprobanteImpago[];
  deudas: DeudaConPdv[]; // aperturas que otros PDV le cargaron a este
}

export type Motivo = "nc" | "rubro" | "auto";

export const MOTIVO_TITULO: Record<Motivo, string> = {
  rubro: "Rubro oculto",
  auto: "Pago automático",
  nc: "Notas de crédito",
};

export function esNotaCredito(f: Pick<ComprobanteImpago, "comprobante">): boolean {
  return f.comprobante.toUpperCase().startsWith("N");
}

export function motivo(f: ComprobanteImpago): Motivo | null {
  if (f.forzada) return null;
  if (esNotaCredito(f)) return "nc";
  if (f.rubroOculto) return "rubro";
  if (f.pagoAutomatico) return "auto";
  return null;
}

export const saldo = (f: Pick<ComprobanteImpago, "total" | "pagado">) => f.total - f.pagado;

export function dias(fecha: string, hoy: Date): number {
  const [a, m, d] = fecha.split("-").map(Number);
  const f = Date.UTC(a, m - 1, d);
  const h = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((h - f) / 86_400_000);
}

export function separar(lista: ComprobanteImpago[]) {
  const impagas: ComprobanteImpago[] = [];
  const excluidas: ComprobanteImpago[] = [];
  for (const f of lista) (motivo(f) ? excluidas : impagas).push(f);
  return { impagas, excluidas };
}

export interface GrupoProveedor {
  clave: string;
  codPro: string;
  proveedor: string;
  proveedorId: number | null;
  items: ComprobanteImpago[];
  saldo: number;
  masVieja: string;
}

export type Orden = "saldo" | "antiguedad";
export type Direccion = "desc" | "asc";

// saldo desc = mayor primero; antigüedad desc = más vieja primero.
export function compararGrupos(orden: Orden, dir: Direccion) {
  const s = dir === "desc" ? 1 : -1;
  return (a: { saldo: number; masVieja: string }, b: { saldo: number; masVieja: string }) =>
    orden === "saldo"
      ? s * (b.saldo - a.saldo)
      : s * a.masVieja.localeCompare(b.masVieja) || b.saldo - a.saldo;
}

export function agrupar(lista: ComprobanteImpago[], orden: Orden, dir: Direccion = "desc"): GrupoProveedor[] {
  const m = new Map<string, GrupoProveedor>();
  for (const f of lista) {
    let g = m.get(f.codPro);
    if (!g) {
      g = { clave: f.codPro, codPro: f.codPro, proveedor: f.proveedor, proveedorId: f.proveedorId, items: [], saldo: 0, masVieja: f.fecha };
      m.set(f.codPro, g);
    }
    g.items.push(f);
  }
  const grupos = [...m.values()];
  for (const g of grupos) {
    // Adentro del proveedor, la factura más nueva primero.
    g.items.sort((a, b) => b.fecha.localeCompare(a.fecha));
    g.saldo = g.items.reduce((s, f) => s + saldo(f), 0);
    g.masVieja = g.items[g.items.length - 1].fecha;
  }
  grupos.sort(compararGrupos(orden, dir));
  return grupos;
}

// Búsqueda tolerante: sin mayúsculas, acentos, espacios ni guiones, y con las
// letras repetidas colapsadas ("Zucala" encuentra "Zuccala"); los números quedan igual.
export const normalizarBusqueda = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[\s\-.]/g, "").replace(/([a-zñ])\1+/g, "$1");
const sinEspacios = normalizarBusqueda;

export function filtrar(
  lista: ComprobanteImpago[],
  { q, solo60, hoy }: { q: string; solo60: boolean; hoy: Date }
): ComprobanteImpago[] {
  const t = sinEspacios(q.trim());
  return lista.filter((f) =>
    (!solo60 || dias(f.fecha, hoy) <= 60) &&
    (!t || sinEspacios(f.proveedor).includes(t) || sinEspacios(f.comprobante).includes(t))
  );
}

export const sumaSaldos = (l: ComprobanteImpago[]) => l.reduce((s, f) => s + saldo(f), 0);

// ── Formatos ────────────────────────────────────────────────────────────────
export const fmtPesos = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");
export const fmtMillones = (n: number) =>
  "$ " + (n / 1e6).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " M";
export function fmtFecha(f: string): string {
  const [a, m, d] = f.split("-");
  return `${d}/${m}/${a}`;
}
// "A000300076701" → "A 0003-00076701"; "NC114008072025" → "NC 1140-08072025".
export function fmtComprobante(c: string): string {
  const letras = /^[A-Za-z]+/.exec(c)?.[0] ?? "";
  const resto = c.slice(letras.length);
  if (resto.length <= 4) return c;
  return `${letras} ${resto.slice(0, 4)}-${resto.slice(4)}`;
}

export type Tramo = "reciente" | "media" | "vieja";
export const tramoAntiguedad = (d: number): Tramo => (d <= 60 ? "reciente" : d <= 120 ? "media" : "vieja");
