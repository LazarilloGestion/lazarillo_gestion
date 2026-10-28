// "Sin carga" (Diego, 28/10/2026): gastos que se cargan todos los meses y en un mes
// todavía no están — como Impagas, pero de lo que falta cargar. Un gasto es "de todos
// los meses" si su proveedor (o su concepto de caja, en los gastos varios) aparece en
// RECURRENTE_MIN de los últimos RECURRENTE_VENTANA meses del PDV. Solo rubros visibles en
// el cuadro de Compras (Diego). Los chicos (< CHICO) se ocultan de entrada.

export const RECURRENTE_MIN = 3;
export const RECURRENTE_VENTANA = 4;
export const MESES_A_MIRAR = 3; // el mes en curso y los dos anteriores
export const CHICO = 1000;

export interface ItemSinCarga {
  clave: string;          // "p:<proveedorId>" | "c:<concepto de caja>"
  nombre: string;         // proveedor, o el concepto si no hay proveedor
  detalle: string;        // concepto principal / "gasto vario" / "sueldos del período"
  rubro: string;
  ultimo: number;         // lo que le tocó a ESTE PDV el último mes (con las aperturas)
  ultimoTotal: number;    // el gasto entero, como se carga en su PDV de origen
  pdvOrigenId: number | null; // dónde se carga (si la apertura lo trae de otro PDV)
  dia: number;            // día habitual de carga
  vencido: boolean;       // se carga a mes vencido (sueldos con período)
  proveedorId: number | null;
  conceptoCodigo: string | null;
  vence: string;          // YYYY-MM-DD en que suele estar cargado
  atrasado: boolean;
}

export interface MesSinCarga { mes: string; items: ItemSinCarga[] }

/** Clave de descarte: "Ya no va" = la clave sola; "Este mes no" = clave + "@YYYY-MM". */
export const claveDescarte = (clave: string, mes?: string | null) => (mes ? `${clave}@${mes}` : clave);
export const mesDeDescarte = (clave: string) => (clave.includes("@") ? clave.split("@")[1] : null);

const p2 = (n: number) => String(n).padStart(2, "0");

/** Día en que suele estar cargado: el día habitual del mes (o del siguiente si va a mes vencido). */
export function venceEl(mes: string, dia: number, vencido: boolean): string {
  let [y, m] = mes.split("-").map(Number);
  if (vencido) { m += 1; if (m > 12) { m = 1; y += 1; } }
  const ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${p2(m)}-${p2(Math.min(Math.max(Math.round(dia) || 1, 1), ult))}`;
}

/** Atrasado: ya pasó el día en que suele estar cargado. */
export function estaAtrasado(vence: string, hoy: string): boolean {
  return hoy > vence;
}

/** Meses a mirar: el de hoy y los anteriores, como "YYYY-MM-01". */
export function mesesObjetivo(hoy: string, n = MESES_A_MIRAR): string[] {
  const [y, m] = hoy.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const t = y * 12 + (m - 1) - i;
    return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}-01`;
  });
}

export function totales(items: ItemSinCarga[], conChicos: boolean) {
  const vis = conChicos ? items : items.filter((x) => x.ultimo >= CHICO);
  return { n: vis.length, total: vis.reduce((s, x) => s + x.ultimo, 0), visibles: vis };
}
