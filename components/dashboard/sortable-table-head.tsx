"use client";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { ColDef } from "./detalle-modal";
import type { SortState } from "@/hooks/use-sort-state";

export function SortableTableHead({
  cols,
  sort,
  onSort,
}: {
  cols: ColDef[];
  sort: SortState;
  onSort: (key: string) => void;
}) {
  return (
    <>
      {cols.map(({ label, icon: Icon, color, bg, right, sortKey }) => (
        <th
          key={label}
          className={`px-4 py-3 ${right ? "text-right" : "text-left"} ${sortKey ? "cursor-pointer select-none" : ""}`}
          onClick={sortKey ? () => onSort(sortKey) : undefined}
        >
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider ${sort?.key === sortKey ? "text-foreground" : "text-muted-foreground"}`}>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${bg}`}>
              <Icon className={`h-3 w-3 ${color}`} />
            </span>
            {label}
            {sortKey && (sort?.key === sortKey
              ? sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
              : <ChevronsUpDown className="h-3 w-3 opacity-40" />)}
          </span>
        </th>
      ))}
    </>
  );
}
