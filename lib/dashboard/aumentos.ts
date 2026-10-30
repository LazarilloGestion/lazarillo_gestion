// Aumentos de precios de la carta (Diego 30/10/2026): se detectan del informe 12 (ventas por
// artículo por día) y se comparan con la Canasta para ver la BRECHA de cada aumento.

export type Grupo = "comidas" | "bebidas" | "promos";
export const GRUPOS: Grupo[] = ["comidas", "bebidas", "promos"];
export const NOMBRE_GRUPO: Record<Grupo, string> = { comidas: "comidas", bebidas: "bebidas", promos: "promos" };

// Agrupación de la carta según el rubro del artículo en MaxiRest. Los mismos patrones se usan en SQL
// (lib/render/aumentos.ts) con ~*, así que tienen que ser regex válidas en JS y en Postgres.
export const PATRON_PROMOS = "promo";
export const PATRON_BEBIDAS = "(cerveza|bebida|trago|limonada|mocktail|cafeter|vino|gaseosa|jugo|aperitiv|espumante)";

export function grupoDeRubro(rubro: string | null | undefined): Grupo {
  const r = rubro ?? "";
  if (new RegExp(PATRON_PROMOS, "i").test(r)) return "promos";
  if (new RegExp(PATRON_BEBIDAS, "i").test(r)) return "bebidas";
  return "comidas";
}

/** Una agrupación en una semana: precios de las 2 semanas anteriores vs las semanas 2 y 3 siguientes. */
export interface VentanaGrupo { semana: string; grupo: Grupo; n: number; suben: number; variacion: number }

// Fuera de un aumento, en esa ventana sube menos de la mitad de los artículos de una agrupación y su
// precio se mueve menos de 3%. Calibrado con el Bar (sep-25 a oct-26): marca 29/09, 01/12, 30/03,
// 15/06, 24/08 y 19/10, y nada más.
export const UMBRAL_SUBEN = 0.5;
export const UMBRAL_VARIACION = 0.03;
export const MIN_ARTICULOS = 15;

export function marcaAumento(v: VentanaGrupo): boolean {
  return v.n >= MIN_ARTICULOS && v.suben >= UMBRAL_SUBEN && v.variacion >= UMBRAL_VARIACION;
}

/**
 * Semanas de aumento. La ventana de 5 semanas marca también las vecinas: las semanas marcadas seguidas
 * son UN aumento, y su fecha es la semana en que más artículos subieron contra la anterior.
 */
export function detectarSemanas(ventanas: VentanaGrupo[], subenSemanal: Map<string, number>): string[] {
  const marcadas = [...new Set(ventanas.filter(marcaAumento).map((v) => v.semana))].sort();
  const grupos: string[][] = [];
  for (const w of marcadas) {
    const ult = grupos[grupos.length - 1];
    if (ult && dias(ult[ult.length - 1], w) <= 7) ult.push(w); else grupos.push([w]);
  }
  return grupos.map((g) => g.reduce((mejor, w) => ((subenSemanal.get(w) ?? 0) > (subenSemanal.get(mejor) ?? 0) ? w : mejor), g[0]));
}

/** "general" si subieron las tres agrupaciones; si no, cuáles. */
export function alcanceAumento(detalle: Partial<Record<Grupo, number | null>> | null | undefined): string | null {
  if (!detalle) return null;
  const suben = GRUPOS.filter((g) => (detalle[g] ?? 0) >= 0.02);
  if (suben.length === 0 || suben.length === GRUPOS.length) return null;
  return `solo ${suben.map((g) => NOMBRE_GRUPO[g]).join(" y ")}`;
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
