// Formato es-AR del campo de monto ($) en el modal de apertura de gastos
// (apertura-destino-row.tsx) — puro, sin DOM. Se arma a mano en vez de usar
// Intl.NumberFormat porque el locale "es" no agrupa los números de 4 dígitos
// ("1234" en vez de "1.234"), y acá el punto de miles es justo lo que ayuda a
// distinguir 10.000 de 100.000 de 1.000.000.
//
// Convención: el punto SIEMPRE es separador de miles y la coma es el decimal.
// Un pegado en formato inglés ("1708820.5") no se puede distinguir de miles, así
// que se interpreta como 17.088.205 — el monto queda visible antes de crear la
// regla.

const DECIMALES_MAX = 2; // mismo criterio que montoDesdePct / pctDesdeMonto (./conversion.ts)

function agruparMiles(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Número canónico → texto a mostrar ("1708820.37" → "1.708.820,37"). */
export function formatearMonto(valor: number): string {
  const redondeado = Math.round(valor * 10 ** DECIMALES_MAX) / 10 ** DECIMALES_MAX;
  const [entera, decimales] = String(redondeado).split(".");
  return decimales ? `${agruparMiles(entera)},${decimales}` : agruparMiles(entera);
}

/**
 * Normaliza lo que el usuario tipea o pega: deja solo dígitos y la primera
 * coma, agrupa los miles y recorta a 2 decimales. Conserva la coma final
 * ("1.234,") para no impedir tipear los decimales.
 */
export function formatearMontoTipeado(texto: string): string {
  const limpio = texto.replace(/[^\d,]/g, "");
  if (limpio === "") return "";

  const posComa = limpio.indexOf(",");
  const parteEntera = (posComa === -1 ? limpio : limpio.slice(0, posComa)).replace(/^0+(?=\d)/, "");
  const entera = parteEntera === "" ? "0" : parteEntera;
  if (posComa === -1) return agruparMiles(entera);

  const decimales = limpio
    .slice(posComa + 1)
    .replace(/,/g, "")
    .slice(0, DECIMALES_MAX);
  return `${agruparMiles(entera)},${decimales}`;
}

/** Texto es-AR → número. null si no hay ningún dígito (vacío, solo coma). */
export function parsearMonto(texto: string): number | null {
  const canonico = texto.replace(/\./g, "").replace(",", ".");
  if (!/\d/.test(canonico)) return null;
  const valor = Number(canonico);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * Dónde dejar el cursor tras reformatear: justo después del mismo carácter
 * significativo (dígito o coma) que tenía a su izquierda. Sin esto, editar un
 * dígito del medio mandaría el cursor al final en cada tecla.
 */
export function posicionTrasFormatear(formateado: string, significativosAntesDelCursor: number): number {
  if (significativosAntesDelCursor <= 0) return 0;
  let vistos = 0;
  for (let i = 0; i < formateado.length; i++) {
    if (formateado[i] !== ".") vistos++;
    if (vistos === significativosAntesDelCursor) return i + 1;
  }
  return formateado.length;
}
