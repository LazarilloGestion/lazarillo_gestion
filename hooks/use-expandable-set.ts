"use client";
import { useCallback, useState } from "react";

export function useExpandableSet() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setExpanded(new Set());
  }, []);

  return { expanded, setExpanded, toggle, collapseAll };
}
