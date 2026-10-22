"use client";
import { useState } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ColDef } from "./compras-detalle-modal";
import type { SortState } from "@/hooks/use-sort-state";

export function SortableTableHead({
  cols,
  sort,
  onSort,
  columnFilters,
  onColumnFilter,
}: {
  cols: ColDef[];
  sort: SortState;
  onSort: (key: string) => void;
  // Filtro por columna (ColDef.filterKey): valor actual y setter. Opcionales
  // para las tablas que no lo usan.
  columnFilters?: Record<string, string>;
  onColumnFilter?: (key: string, value: string) => void;
}) {
  // Columna cuyo filtro está abierto (input a la vista). Un filtro con texto
  // sigue aplicado aunque se cierre; el embudo queda marcado.
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <>
      {cols.map(({ label, icon: Icon, color, bg, right, sortKey, filterKey, width }) => {
        const valor = filterKey ? (columnFilters?.[filterKey] ?? "") : "";
        const conFiltro = valor.trim().length > 0;
        const editando = filterKey != null && abierto === filterKey;
        return (
          <th
            key={label}
            className={cn("px-3 py-2 align-middle", right ? "text-right" : "text-left", width)}
          >
            {editando && filterKey && onColumnFilter ? (
              <span className="flex items-center gap-1">
                <input
                  autoFocus
                  value={valor}
                  placeholder={`Filtrar ${label.toLowerCase()}…`}
                  onChange={(e) => onColumnFilter(filterKey, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { onColumnFilter(filterKey, ""); setAbierto(null); }
                    if (e.key === "Enter") setAbierto(null);
                  }}
                  onBlur={() => setAbierto(null)}
                  className="h-6 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] font-normal normal-case tracking-normal outline-none focus:border-ring"
                />
                <button
                  type="button"
                  title="Quitar filtro"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onColumnFilter(filterKey, ""); setAbierto(null); }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider max-w-full", sort?.key === sortKey ? "text-foreground" : "text-muted-foreground")}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${bg}`}>
                  <Icon className={`h-3 w-3 ${color}`} />
                </span>
                <button
                  type="button"
                  onClick={sortKey ? () => onSort(sortKey) : undefined}
                  className={cn("inline-flex items-center gap-1 truncate", sortKey ? "cursor-pointer select-none hover:text-foreground" : "cursor-default")}
                >
                  <span className="truncate">{label}</span>
                  {sortKey && (sort?.key === sortKey
                    ? sort.dir === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />
                    : <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />)}
                </button>
                {filterKey && onColumnFilter && (
                  <button
                    type="button"
                    title={conFiltro ? `Filtro: ${valor}` : `Filtrar ${label.toLowerCase()}`}
                    onClick={() => setAbierto(filterKey)}
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
                      conFiltro ? "bg-primary text-primary-foreground" : "text-muted-foreground/50 hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Filter className="h-3 w-3" />
                  </button>
                )}
              </span>
            )}
          </th>
        );
      })}
    </>
  );
}
