"use client";
import { useFetchQuery } from "./use-fetch-query";
import type { ReglaAperturaDTO } from "@/lib/apertura/types";

// Una sola query cacheada por TanStack Query, compartida entre el badge/ícono
// de pivot-table.tsx (Task 12) y la lista/línea de tiempo de
// apertura-gastos-modal.tsx (Task 11) — volumen de reglas bajo (decenas, no
// miles), sin endpoint filtrado nuevo (YAGNI).
export function useReglasApertura() {
  const { data, isLoading, error } = useFetchQuery<{ data: ReglaAperturaDTO[] }>(
    ["apertura-reglas"],
    "/api/apertura/reglas"
  );
  return { reglas: data?.data ?? [], isLoading, error };
}
