"use client";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { MONTH_IDXS } from "@/lib/dashboard/constants";

export function usePivotMonths() {
  const searchParams = useSearchParams();
  const months = useMemo(() => {
    const raw = searchParams.get("months");
    if (!raw) return MONTH_IDXS;
    const parsed = raw.split(",").map(Number).filter((n) => n >= 1 && n <= 12);
    return parsed.length > 0 ? parsed : MONTH_IDXS;
  }, [searchParams]);
  const activeMonths = months.length < 12 ? months : undefined;
  return { months, activeMonths };
}
