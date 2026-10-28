"use client";
import { useQuery } from "@tanstack/react-query";
import { HttpError, REINTENTOS } from "@/lib/query-retry";

// Reintentos: uno solo y solo si el error es pasajero (28/10/2026, ver lib/query-retry.ts).
// Antes eran 2 con backoff y, con la base saturada, multiplicaban los pedidos.

export function useFetchQuery<T>(
  queryKey: unknown[],
  url: string | null,
  opts?: { staleTime?: number; enabled?: boolean }
) {
  return useQuery<T>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url!);
      if (!res.ok) throw new HttpError(res.status);
      return res.json() as Promise<T>;
    },
    enabled: opts?.enabled !== false && url !== null,
    staleTime: opts?.staleTime ?? 30_000,
    ...REINTENTOS,
  });
}
