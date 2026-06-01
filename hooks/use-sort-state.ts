"use client";
import { useState } from "react";

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export function useSortState() {
  const [sort, setSort] = useState<SortState>(null);

  function handleSortClick(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  return { sort, handleSortClick };
}
