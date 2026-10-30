// Aumentos de precios de la carta (Diego 30/10/2026): se detectan del informe 12 (ventas por
// artículo por día) y se comparan con la Canasta para ver la BRECHA de cada aumento.

export interface SemanaPrecios {
  semana: string;   // lunes, "YYYY-MM-DD"
  n: number;        // artículos comparables con la semana anterior
  suben: number;    // fracción de esos artículos que subieron más de 3%
  variacion: number; // variación de precio ponderada por lo vendido (0,05 = +5%)
}

// Fuera de un aumento, cada semana sube ~15–25% de los artículos (promos, descuentos) y la variación
// ponderada ronda ±2%: un aumento general es más de un tercio de la carta subiendo y la carta +2,5%.
export const UMBRAL_SUBEN = 0.35;
export const UMBRAL_VARIACION = 0.025;
export const MIN_ARTICULOS = 20;

/** Semanas de aumento. Un aumento que se aplica en dos semanas seguidas cuenta una vez (la primera). */
export function detectarSemanas(semanas: SemanaPrecios[]): string[] {
  const orden = [...semanas].sort((a, b) => a.semana.localeCompare(b.semana));
  const out: string[] = [];
  let anterior: string | null = null;
  for (const s of orden) {
    const es = s.n >= MIN_ARTICULOS && s.suben >= UMBRAL_SUBEN && s.variacion >= UMBRAL_VARIACION;
    if (es && !(anterior && dias(anterior, s.semana) <= 7)) out.push(s.semana);
    anterior = es ? s.semana : null;
  }
  return out;
}

export function dias(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export interface FilaAumento {
  fecha: string;
  carta: number | null;       // cuánto subió la carta
  provisorio: boolean;
  costos: number | null;      // cuánto subió la Canasta desde el aumento anterior
  hastaMes: string | null;    // último mes contado (si el aumento cae después del mes de referencia)
  brecha: number | null;      // (1 + carta) / (1 + costos) − 1: positivo = el aumento cubrió los costos
}

/**
 * Para cada aumento (desde el segundo dentro de la ventana), cuánto subieron los costos desde el
 * anterior: los meses DESPUÉS del mes del aumento anterior hasta el mes de este aumento (o hasta el
 * último mes cerrado si este cae después).
 */
export function aumentosVsCostos(
  meses: string[], canasta: (number | null)[],
  aumentos: { fecha: string; pct: number | null; provisorio?: boolean }[],
): FilaAumento[] {
  const orden = [...aumentos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ref = meses[meses.length - 1];
  return orden.map((a, i) => {
    const prev = orden[i - 1];
    let costos: number | null = null;
    let hastaMes: string | null = null;
    if (prev && prev.fecha.slice(0, 7) >= meses[0]) {
      const desde = prev.fecha.slice(0, 7), hasta = a.fecha.slice(0, 7) <= ref ? a.fecha.slice(0, 7) : ref;
      if (a.fecha.slice(0, 7) > ref) hastaMes = ref;
      let x = 1, alguno = false;
      meses.forEach((m, k) => {
        const v = canasta[k];
        if (m > desde && m <= hasta && v != null) { x *= 1 + v; alguno = true; }
      });
      costos = alguno ? x - 1 : 0;
    }
    const carta = a.pct;
    return {
      fecha: a.fecha, carta, provisorio: !!a.provisorio, costos, hastaMes,
      brecha: carta != null && costos != null ? (1 + carta) / (1 + costos) - 1 : null,
    };
  });
}
