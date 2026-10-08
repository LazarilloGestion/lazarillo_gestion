import { defaultFilter } from "cmdk";
import { quitarAcentos } from "@/lib/dashboard/observacion-busqueda";

// cmdk vuelve a filtrar en el cliente lo que ya devolvió el servidor. El servidor ignora acentos
// (query-builders.ts); sin esto, "eléctrico" escondería resultados que dicen "electrico".
export function filtroSinAcentos(value: string, search: string, keywords?: string[]): number {
  return defaultFilter(quitarAcentos(value), quitarAcentos(search), keywords?.map(quitarAcentos));
}
