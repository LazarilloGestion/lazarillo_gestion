"use client";
import { useQuery } from "@tanstack/react-query";

// Config de retry/backoff que useFetchQuery aplica a toda query: 2 reintentos con
// backoff exponencial (1s, 2s, 4s...) topeado a 30s, para no perder en silencio la
// resiliencia a fallas transitorias de red (hallazgo de code-review, 24-ago-2026).
const FETCH_QUERY_RETRY = {
  retry: 2,
  retryDelay: (i: number) => Math.min(1000 * 2 ** i, 30_000),
} as const;

export function useFetchQuery<T>(
  queryKey: unknown[],
  url: string | null,
  opts?: { staleTime?: number; enabled?: boolean }
) {
  return useQuery<T>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url!);
      if (!res.ok) throw new Error("Error cargando datos");
      return res.json() as Promise<T>;
    },
    enabled: opts?.enabled !== false && url !== null,
    staleTime: opts?.staleTime ?? 30_000,
    ...FETCH_QUERY_RETRY,
  });
}
