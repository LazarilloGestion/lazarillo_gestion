import type { Local } from "@/lib/types/domain";

/**
 * Texto legible del origen de una regla de apertura a partir de IDs sueltos.
 * Un PDV se nombra calificado por su local (`Local — PDV`): los nombres de PDV
 * se repiten entre locales (p.ej. "Bar" existe en Ramos Mejía y en San Justo),
 * así que el PDV a secas es ambiguo. Sin PDV, el origen es el local entero.
 * Los fallbacks cubren el caso de que la lista remota de locales todavía no
 * cargó o no incluye el ID (no queremos romper el render por eso).
 */
export function describirOrigen(
  locales: Local[],
  localId: number | null,
  puntoDeVentaId: number | null,
): string {
  const local = locales.find((l) => l.id === localId);
  if (puntoDeVentaId != null) {
    const pv = local?.puntosDeVenta.find((p) => p.id === puntoDeVentaId);
    if (local && pv) return `${local.nombre} — ${pv.nombre}`;
    return "Punto de venta";
  }
  return `${local?.nombre ?? "Local"} (todo el local)`;
}
