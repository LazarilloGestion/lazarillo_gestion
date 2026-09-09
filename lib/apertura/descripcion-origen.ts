import type { Local } from "@/lib/types/domain";

/**
 * Texto legible del origen de una regla de apertura a partir de IDs sueltos.
 * Un PDV puntual se nombra solo; sin PDV, el origen es el local entero.
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
    return pv?.nombre ?? "Punto de venta";
  }
  return `${local?.nombre ?? "Local"} (todo el local)`;
}
