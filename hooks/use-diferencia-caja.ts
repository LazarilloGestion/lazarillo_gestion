"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { buildDiferenciaCajaUrl } from "@/lib/dashboard/params";
import { MONTH_IDXS } from "@/lib/dashboard/constants";

interface Params {
  year: number;
  localId?: number;
  pdvId?: number;
}

interface DiferenciaCajaResponse {
  diferenciaPorMes: Record<number, number | null>;
}

// Diferencia de caja acumulada (ver spec 2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico
// y Fix_Diferencia_Caja.pdf). Toda la orquestación —primer arqueo, agregados por mes del rango de
// años, cálculo acumulado— vive server-side en GET /api/dashboard/diferencia-caja; acá solo se
// consume en un request. Un mes sin arqueo cargado viene como null (celda "—").
export function useDiferenciaCaja({ year, localId, pdvId }: Params) {
  const { data, isLoading, isError } = useFetchQuery<DiferenciaCajaResponse>(
    ["diferencia-caja", year, localId, pdvId],
    buildDiferenciaCajaUrl(year, localId, pdvId),
    { staleTime: 30_000 },
  );

  const diferenciaPorMes: Record<number, number | null> = {};
  for (const mes of MONTH_IDXS) diferenciaPorMes[mes] = data?.diferenciaPorMes[mes] ?? null;

  return { diferenciaPorMes, isLoading, isError };
}
