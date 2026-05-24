"use client";
import { useQuery } from "@tanstack/react-query";

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
    retry: 2,
    retryDelay: (i) => Math.min(1000 * 2 ** i, 30_000),
  });
}
