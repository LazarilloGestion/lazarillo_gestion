// Etiquetas de la barra de filtros unificada del Panel (rediseño, Diego 30/10/2026).
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Meses elegidos en corto: ninguno = "Todo el año"; seguidos = "Ene–Oct"; sueltos = "Ene, Mar, Jun" (o "5 meses"). */
export function etiquetaMeses(meses: Iterable<number>): string {
  const xs = [...new Set(meses)].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  if (xs.length === 0 || xs.length === 12) return "Todo el año";
  if (xs.length === 1) return MESES[xs[0] - 1];
  const seguidos = xs.every((m, i) => i === 0 || m === xs[i - 1] + 1);
  if (seguidos) return `${MESES[xs[0] - 1]}–${MESES[xs[xs.length - 1] - 1]}`;
  if (xs.length <= 3) return xs.map((m) => MESES[m - 1]).join(", ");
  return `${xs.length} meses`;
}

/** Valor del selector Local·PDV: "__all", "l:<local>" o "p:<local>:<pdv>". */
export function valorLugar(localId?: number, pdvId?: number): string {
  if (localId == null) return "__all";
  return pdvId == null ? `l:${localId}` : `p:${localId}:${pdvId}`;
}

export function leerLugar(v: string): { localId?: number; pdvId?: number } {
  const [t, a, b] = v.split(":");
  if (t === "l") return { localId: Number(a) };
  if (t === "p") return { localId: Number(a), pdvId: Number(b) };
  return {};
}
