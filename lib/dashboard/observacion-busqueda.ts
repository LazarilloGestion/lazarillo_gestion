// Tabla única de acentos: la usan el translate() del SQL (columna) y quitarAcentos (lo tipeado),
// así ambos lados se normalizan igual. La ñ queda afuera a propósito: "año" y "ano" son distintas.
// translate() exige que ambas cadenas tengan el mismo largo (reemplazo carácter a carácter).
export const ACENTOS_DESDE = "áéíóúüÁÉÍÓÚÜ";
export const ACENTOS_HACIA = "aeiouuAEIOUU";

const REEMPLAZOS = new Map([...ACENTOS_DESDE].map((c, i) => [c, ACENTOS_HACIA[i]]));

export function quitarAcentos(texto: string): string {
  return [...texto].map((c) => REEMPLAZOS.get(c) ?? c).join("");
}

const MIN_CARACTERES = 2;

// Opción del buscador para filtrar por lo tipeado (contenido parcial), en vez de por la
// observación completa de una compra puntual.
export function opcionContiene(tipeado: string): { query: string; label: string } | null {
  const query = tipeado.trim();
  if (query.length < MIN_CARACTERES) return null;
  return { query, label: `contiene «${query}»` };
}
