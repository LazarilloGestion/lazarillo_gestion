"use client";
import { useQuery } from "@tanstack/react-query";

// Compartido con hooks que arman su propio queryFn en vez de un fetch de una
// sola URL (ej. use-diferencia-caja.ts agregando varios endpoints) — para que
// no pierdan silenciosamente la resiliencia a fallas transitorias que
// useFetchQuery sí da (hallazgo de code-review, 24-ago-2026).
export const FETCH_QUERY_RETRY = {
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
