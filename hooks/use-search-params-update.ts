"use client";
import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function useSearchParamsUpdate() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      router.replace(`/dashboard?${params.toString()}`);
    },
    [router, searchParams]
  );
}
