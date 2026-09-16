"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { buildDiferenciaCajaUrl } from "@/lib/dashboard/params";
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import type { DiferenciaCajaMes } from "@/lib/dashboard/diferencia-caja-serie";

interface Params {
  year: number;
  localId?: number;
  pdvId?: number;
}

interface DiferenciaCajaResponse {
  diferenciaPorMes: Record<number, DiferenciaCajaMes>;
}

const MES_VACIO: DiferenciaCajaMes = { valor: null, acumulado: null };

// Diferencia de caja por mes + acumulado como dato secundario (ver spec 2026-09-16 y
// 2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico). Toda la orquestación —primer
// arqueo, agregados por mes del rango de años, ambos cálculos— vive server-side en
// GET /api/dashboard/diferencia-caja; acá solo se consume en un request. Un mes sin arqueo
// cargado viene como { valor: null, acumulado: null } (celda "—").
export function useDiferenciaCaja({ year, localId, pdvId }: Params) {
  const { data, isLoading, isError } = useFetchQuery<DiferenciaCajaResponse>(
    ["diferencia-caja", year, localId, pdvId],
    buildDiferenciaCajaUrl(year, localId, pdvId),
    { staleTime: 30_000 },
  );

  const diferenciaPorMes: Record<number, DiferenciaCajaMes> = {};
  for (const mes of MONTH_IDXS) diferenciaPorMes[mes] = data?.diferenciaPorMes[mes] ?? MES_VACIO;

  return { diferenciaPorMes, isLoading, isError };
}
