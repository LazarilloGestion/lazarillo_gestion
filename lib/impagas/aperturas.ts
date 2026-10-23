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
  totalCompra?: number;   // total del comprobante (todas las partes)
  aplicado: number;       // pagos al origen imputados a este movimiento
  esEmpleado?: boolean;   // sueldo / adelanto de un empleado (nombre completo desde la nómina)
  rubro?: string;         // rubro del concepto de caja (Gastos En Personal, Mercaderias…)
  ops?: number[];         // órdenes de pago imputadas a este movimiento
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

// Número visible de la orden de pago: "OP 0012".
export const numeroOP = (id: number) => `OP ${String(id).padStart(4, "0")}`;

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

// Pago sobre movimientos elegidos (un mes, un empleado o una selección):
// sin importe se salda el saldo entero de cada uno; con importe se imputa a lo
// elegido del más viejo al más nuevo (el último puede quedar parcial) y lo que
// sobra queda a cuenta, sin asociar a ningún movimiento.
export function imputarElegidos(
  movs: Pick<MovimientoApertura, "key" | "fecha" | "importe" | "aplicado">[],
  keys: string[],
  importe?: number
): { aplicaciones: { key: string; importe: number }[]; sobrante: number } {
  const elegidos = new Set(keys);
  const l = movs.filter((m) => elegidos.has(m.key));
  if (importe === undefined) {
    const aplicaciones = ordenarMovimientos(l)
      .map((m) => ({ key: m.key, importe: redondear(saldoMov(m)) }))
      .filter((a) => a.importe > 0);
    return { aplicaciones, sobrante: 0 };
  }
  return imputarFifo(l, importe);
}

// Disponible de una orden de pago (lo que quedó a cuenta, sin imputar).
export const disponibleOP = (p: Pick<PagoInterno, "importe" | "aplicado">) => redondear(Math.max(0, p.importe - p.aplicado));

// Al editar el importe de una orden de pago: se vuelve a imputar primero a los
// mismos movimientos que tenía (del más viejo al más nuevo) y, si sobra, a lo
// más viejo pendiente; lo que no entra queda a cuenta.
export function reimputar(
  movs: Pick<MovimientoApertura, "key" | "fecha" | "importe" | "aplicado">[],
  antes: string[],
  importe: number
): { aplicaciones: { key: string; importe: number }[]; sobrante: number } {
  const previos = new Set(antes);
  const r1 = imputarFifo(movs.filter((m) => previos.has(m.key)), importe);
  const r2 = imputarFifo(movs.filter((m) => !previos.has(m.key)), r1.sobrante);
  return { aplicaciones: [...r1.aplicaciones, ...r2.aplicaciones], sobrante: r2.sobrante };
}

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

// Dentro de un mes: los sueldos de un mismo empleado (liquidación, presentismo,
// feriados, adelantos…) van juntos en una fila por empleado; el resto queda
// movimiento por movimiento. Mantiene el orden recibido (más nuevo primero).
export type FilaMes =
  | { tipo: "mov"; mov: MovimientoApertura }
  | { tipo: "empleado"; nombre: string; movimientos: MovimientoApertura[]; total: number; saldo: number; aplicado: number };

export function agruparEmpleados(movs: MovimientoApertura[]): FilaMes[] {
  const out: FilaMes[] = [];
  const porNombre = new Map<string, Extract<FilaMes, { tipo: "empleado" }>>();
  for (const m of movs) {
    if (!m.esEmpleado) { out.push({ tipo: "mov", mov: m }); continue; }
    let g = porNombre.get(m.proveedor);
    if (!g) {
      g = { tipo: "empleado", nombre: m.proveedor, movimientos: [], total: 0, saldo: 0, aplicado: 0 };
      porNombre.set(m.proveedor, g);
      out.push(g);
    }
    g.movimientos.push(m);
    g.total = redondear(g.total + m.importe);
    g.saldo = redondear(g.saldo + saldoMov(m));
    g.aplicado = redondear(g.aplicado + m.aplicado);
  }
  return out;
}

// ── Deuda con un PDV agrupada por rubro ─────────────────────────────────────
// Cada rubro se ve como uno elija: por proveedor, por concepto o por empleado
// (por insumo, próximamente). Por defecto Personal va por empleado y el resto
// por concepto. Dentro de cada grupo, el movimiento más nuevo primero.
export const MODOS_RUBRO = ["proveedor", "concepto", "empleado", "insumo"] as const;
export type ModoRubro = (typeof MODOS_RUBRO)[number];
export const ETIQUETA_MODO: Record<ModoRubro, string> = {
  proveedor: "por proveedor", concepto: "por concepto", empleado: "por empleado", insumo: "por insumo",
};
export const modoDefault = (rubro: string): ModoRubro => (/personal/i.test(rubro) ? "empleado" : "concepto");

export interface GrupoRubro { clave: string; movimientos: MovimientoApertura[]; total: number; saldo: number; aplicado: number; esEmpleado: boolean }
export interface RubroDeuda { rubro: string; modo: ModoRubro; grupos: GrupoRubro[]; total: number; saldo: number; movimientos: MovimientoApertura[] }

// En "por empleado" los que no son sueldos (cargas sociales, gastos varios del
// personal) van por su concepto. "Por insumo" todavía no existe: va por concepto.
function claveGrupo(m: MovimientoApertura, modo: ModoRubro): string {
  if (modo === "proveedor") return m.proveedor || "—";
  if (modo === "empleado" && m.esEmpleado) return m.proveedor || "—";
  return m.concepto || "Sin concepto";
}

export function porRubro(movs: MovimientoApertura[], modos: Record<string, ModoRubro> = {}): RubroDeuda[] {
  const rubros = new Map<string, MovimientoApertura[]>();
  for (const m of ordenarMovimientos(movs).reverse()) {
    const r = m.rubro || "Sin rubro";
    if (!rubros.has(r)) rubros.set(r, []);
    rubros.get(r)!.push(m);
  }
  const suma = (l: MovimientoApertura[], f: (m: MovimientoApertura) => number) => redondear(l.reduce((s, x) => s + f(x), 0));
  return [...rubros.entries()].map(([rubro, l]) => {
    const modo = modos[rubro] ?? modoDefault(rubro);
    const g = new Map<string, MovimientoApertura[]>();
    for (const m of l) {
      const k = claveGrupo(m, modo);
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(m);
    }
    const grupos = [...g.entries()].map(([clave, ms]) => ({
      clave, movimientos: ms, total: suma(ms, (x) => x.importe), saldo: suma(ms, saldoMov), aplicado: suma(ms, (x) => x.aplicado),
      esEmpleado: modo === "empleado" && ms.every((x) => x.esEmpleado),
    })).sort((a, b) => b.saldo - a.saldo || b.total - a.total || a.clave.localeCompare(b.clave));
    return { rubro, modo, grupos, movimientos: l, total: suma(l, (x) => x.importe), saldo: suma(l, saldoMov) };
  }).sort((a, b) => b.saldo - a.saldo || b.total - a.total || a.rubro.localeCompare(b.rubro));
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

// Cursor del input de importe: al reformatear (puntos de miles) el cursor no
// debe saltar al final. Se cuentan los caracteres que importan (dígitos y la
// coma) antes del cursor y se lo vuelve a poner después de la misma cantidad.
const significativo = (c: string) => /[\d,]/.test(c);

export function contarAntesDelCursor(texto: string, cursor: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(cursor, texto.length); i++) if (significativo(texto[i])) n++;
  return n;
}

export function cursorTrasSignificativos(formateado: string, n: number): number {
  if (n <= 0) {
    const i = formateado.search(/[\d,]/);
    return i < 0 ? formateado.length : i;
  }
  let c = 0;
  for (let i = 0; i < formateado.length; i++) {
    if (significativo(formateado[i]) && ++c === n) return i + 1;
  }
  return formateado.length;
}

export const importeAInput = (n: number) =>
  formatearImporteAR(redondear(n).toFixed(2).replace(".", ",").replace(/,00$/, ""));

// % de la regla de apertura de un grupo: "15%" si todos iguales, "10–15%" si varía.
export function rangoPorcentaje(movs: Pick<MovimientoApertura, "porcentaje">[]): string | null {
  const ps = movs.map((m) => m.porcentaje).filter((p) => Number.isFinite(p) && p > 0);
  if (!ps.length) return null;
  const fmt = (n: number) => `${Math.round(n * 10) / 10}`.replace(".", ",");
  const min = Math.min(...ps), max = Math.max(...ps);
  return Math.abs(max - min) < 0.05 ? `${fmt(min)}%` : `${fmt(min)}–${fmt(max)}%`;
}

// Tooltip del importe de un movimiento: la parte de este PDV sobre el total.
export function textoParte(m: Pick<MovimientoApertura, "importe" | "totalCompra" | "porcentaje">, fmt: (n: number) => string): string {
  const pct = `${Math.round(m.porcentaje * 10) / 10}`.replace(".", ",");
  return m.totalCompra && Math.abs(m.totalCompra) > 0.5
    ? `${fmt(m.importe)} de ${fmt(m.totalCompra)} (${pct}%)`
    : `${fmt(m.importe)} (${pct}%)`;
}
