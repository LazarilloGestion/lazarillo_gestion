"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { buildRangoAniosUrl } from "@/lib/dashboard/params";

interface RangoAniosResponse {
  minYear: number | null;
  maxYear: number;
}

/**
 * Rango de años navegable en el dashboard, derivado de las fechas ya importadas
 * (compras + ventas), filtrado por local/PDV. Mientras carga o si falla,
 * `minYear`/`maxYear` quedan `undefined` — los botones de navegación se
 * deshabilitan hasta tener el rango real (useFetchQuery ya reintenta).
 */
export function useAnioRange(localId?: number, pdvId?: number) {
  const query = useFetchQuery<RangoAniosResponse>(
    ["anio-range", localId, pdvId],
    buildRangoAniosUrl(localId, pdvId),
    { staleTime: 60_000 },
  );

  return {
    minYear: query.data?.minYear ?? undefined,
    maxYear: query.data?.maxYear ?? undefined,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
