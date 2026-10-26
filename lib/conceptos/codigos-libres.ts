// Códigos libres de conceptos de caja (Diego 26/10/2026: en MaxiRest cuesta
// encontrar un código libre para dar de alta un concepto). MaxiRest usa
// códigos de 1 a 999.
export const MAX_CODIGO_CONCEPTO = 999;

export type Rango = { desde: number; hasta: number };

export function rangosLibres(usados: Iterable<number>, max = MAX_CODIGO_CONCEPTO): Rango[] {
  const ocupado = new Set<number>();
  for (const u of usados) if (Number.isInteger(u) && u >= 1 && u <= max) ocupado.add(u);
  const out: Rango[] = [];
  let desde: number | null = null;
  for (let c = 1; c <= max + 1; c++) {
    const libre = c <= max && !ocupado.has(c);
    if (libre && desde == null) desde = c;
    if (!libre && desde != null) {
      out.push({ desde, hasta: c - 1 });
      desde = null;
    }
  }
  return out;
}

export const cantidadLibres = (rangos: Rango[]) => rangos.reduce((a, r) => a + r.hasta - r.desde + 1, 0);

export const textoRango = (r: Rango) => (r.desde === r.hasta ? String(r.desde) : `${r.desde}–${r.hasta}`);

// Primer libre después de un código dado (para "dame uno cerca del 300").
export function libreDesde(rangos: Rango[], desde: number): number | null {
  for (const r of rangos) {
    if (r.hasta < desde) continue;
    return Math.max(r.desde, desde);
  }
  return null;
}
