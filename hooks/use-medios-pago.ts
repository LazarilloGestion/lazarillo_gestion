"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import type { MedioPago } from "@/lib/medios-pago/abm";

export const MEDIOS_PAGO_KEY = ["medios-pago"];

// Medios del gestor (activos y desactivados; cada selector filtra con mediosParaElegir).
export function useMediosPago() {
  return useFetchQuery<MedioPago[]>(MEDIOS_PAGO_KEY, "/api/medios-pago", { staleTime: 5 * 60_000 });
}
