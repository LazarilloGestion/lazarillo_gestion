// Canasta = inflación PROPIA de los costos de un PDV (Diego 30/10/2026; metodología en la memoria
// canasta-y-presupuestador). Cuatro componentes, cada uno medido como precio y no como gasto:
//   mercaderías  Laspeyres por insumo del informe 25 (saltos fuera de ×1,5 / ÷1,5 = "a revisar")
//   sueldos      mediana de la variación del MISMO empleado (sin SAC, feriados, adelantos)
//   servicios    mediana de la variación de cada proveedor × concepto (abonos)
//   alquiler     el monto — por ahora EN REVISIÓN: se muestra en gris y no entra al %
// Pesos: lo que pesa cada componente en los gastos de los últimos 6 meses (con aperturas).

export type ClaveComponente = "mercaderias" | "sueldos" | "servicios" | "alquiler";

export interface Componente {
  clave: ClaveComponente;
  nombre: string;
  peso: number;                      // gasto de los últimos 6 meses (pesos)
  variaciones: (number | null)[];    // variación vs el mes anterior (0,03 = +3%), una por mes
  cuenta: boolean;                   // false = se muestra pero no entra a la canasta
  aRevisar?: number;                 // insumos apartados por saltos raros (mes de referencia)
}

/** "YYYY-MM" de los n meses que terminan en anio/mes (el último es el de referencia). */
export function mesesHasta(anio: number, mes: number, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anio, mes - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Canasta de cada mes: promedio de las variaciones de los componentes que cuentan, por su peso. */
export function canastaMensual(comps: Componente[], n: number): (number | null)[] {
  return Array.from({ length: n }, (_, i) => {
    let s = 0, w = 0;
    for (const c of comps) {
      const v = c.variaciones[i];
      if (!c.cuenta || v == null || !(c.peso > 0)) continue;
      s += v * c.peso; w += c.peso;
    }
    return w > 0 ? s / w : null;
  });
}

/** Variación acumulada (compuesta) de los meses desde..hasta inclusive; sin datos = null. */
export function acumulada(serie: (number | null)[], desde: number, hasta: number): number | null {
  let x = 1, alguno = false;
  for (let i = Math.max(0, desde); i <= hasta && i < serie.length; i++) {
    const v = serie[i];
    if (v == null) continue;
    x *= 1 + v; alguno = true;
  }
  return alguno ? x - 1 : null;
}

/**
 * Desde el último aumento: el último con fecha hasta el fin del mes de referencia. Cuenta los meses
 * DESPUÉS del mes del aumento (el aumento ya cubría lo de ese mes). Devuelve también si hubo un
 * aumento posterior al mes de referencia (para mostrar "aumentaste el dd/mm").
 */
export function ventanaUltimoAumento(meses: string[], aumentos: string[]): {
  base: string | null; desdeIdx: number | null; posterior: string | null;
} {
  const ref = meses[meses.length - 1];
  const orden = [...aumentos].sort();
  const base = [...orden].reverse().find((f) => f.slice(0, 7) <= ref) ?? null;
  const posterior = orden.find((f) => f.slice(0, 7) > ref) ?? null;
  if (!base) return { base: null, desdeIdx: null, posterior };
  const idx = meses.findIndex((m) => m > base.slice(0, 7));
  return { base, desdeIdx: idx === -1 ? meses.length : idx, posterior };
}

export function pesoRelativo(comps: Componente[]): Map<ClaveComponente, number> {
  const tot = comps.filter((c) => c.cuenta).reduce((s, c) => s + Math.max(0, c.peso), 0);
  return new Map(comps.map((c) => [c.clave, c.cuenta && tot > 0 ? Math.max(0, c.peso) / tot : 0]));
}
