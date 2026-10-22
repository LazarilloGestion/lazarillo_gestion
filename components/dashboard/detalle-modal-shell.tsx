"use client";
import { useMemo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { SearchInput } from "@/components/ui/search-input";
import { SortableTableHead } from "./sortable-table-head";
import { useSortState, type SortState } from "@/hooks/use-sort-state";
import { useTableSearch } from "@/hooks/use-table-search";
import type { ColDef } from "./compras-detalle-modal";
import { cn } from "@/lib/utils";
import type { DetalleResponse } from "@/lib/dashboard/types";

interface DetalleModalShellProps<T> {
  open: boolean;
  onClose: () => void;
  title: string;
  cols: ColDef[];
  queryKey: unknown[];
  queryFn: () => Promise<DetalleResponse<T>>;
  searchFields: (item: T) => (string | null | undefined)[];
  // Valor de cada columna filtrable (ColDef.filterKey → texto) para el filtro por columna.
  columnFields?: (item: T) => Record<string, string | null | undefined>;
  sortFn?: (a: T, b: T, sort: SortState) => number;
  renderRow: (item: T, portalContainer: HTMLElement | null) => React.ReactNode;
  saveError?: string | null;
  isEditing?: boolean;
  footerNote?: string | null;
  // Controles del período junto al título (‹ Julio 2026 › + Mes/Año/Histórico).
  headerControls?: React.ReactNode;
  // Texto del pie en vez del conteo a secas (ej. "139 registros — Julio 2026").
  periodoLabel?: string | null;
}

export function DetalleModalShell<T>({
  open,
  onClose,
  title,
  cols,
  queryKey,
  queryFn,
  searchFields,
  columnFields,
  sortFn,
  renderRow,
  saveError,
  isEditing,
  footerNote,
  headerControls,
  periodoLabel,
}: DetalleModalShellProps<T>) {
  const { sort, handleSortClick } = useSortState();
  // Portal container para popovers/selects anidados: sin esto, montan en document.body
  // y quedan fuera del scroll-lock del Dialog (el scroll con la rueda deja de andar).
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);

  const { data: response, isLoading, error } = useQuery<DetalleResponse<T>>({
    queryKey,
    queryFn,
    enabled: open,
    staleTime: 60_000,
    retry: 2,
    retryDelay: (i) => Math.min(1000 * 2 ** i, 30_000),
  });

  const rawData = response?.data;
  const count = rawData?.length ?? 0;

  const data = useMemo(() => {
    if (!rawData || !sort || !sortFn) return rawData ?? [];
    return [...rawData].sort((a, b) => sortFn(a, b, sort));
  }, [rawData, sort, sortFn]);

  const { query, setQuery, columnFilters, setColumnFilter, clearFilters, hayFiltros, filtered } =
    useTableSearch(data, searchFields, columnFields);

  useEffect(() => { clearFilters(); }, [queryKey, clearFilters]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        ref={setContentEl}
        showCloseButton={false}
        className={cn(
          // Ancho fijo al viewport (no w-fit): la tabla entra en pantalla y
          // Detalle/Observación se comprimen con puntos suspensivos (punto 2,
          // Etapa 3) en vez de desbordar con scroll horizontal.
          "w-[calc(100vw-2rem)] sm:w-[94vw] max-w-[94vw] sm:max-w-[1600px] max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden",
          // Mientras se edita una fila, el combo de concepto puede necesitar desbordar
          // el modal (como ya hace el Select de rubro al portar a document.body).
          // Sin esto, overflow-hidden lo recorta contra el borde del modal.
          isEditing && "overflow-visible"
        )}
      >

        {/* Encabezado FUERA de la tabla: antes iba en el <thead> y se desplazaba
            con el scroll horizontal, dejando el título cortado. */}
        <div className="px-6 pt-4 pb-3 shrink-0 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-wrap">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            {headerControls}
          </div>
          {!isLoading && !error && count > 1 && <SearchInput value={query} onChange={setQuery} className="w-44 shrink-0" />}
        </div>

        {isLoading && <div className="flex items-center justify-center py-12"><Spinner size="lg" /></div>}
        {error && <div className="py-12 text-center text-sm text-destructive">Error al cargar los datos.</div>}
        {!isLoading && !error && count === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">Sin registros para la selección.</div>
        )}

        {/* La API recorta en DETALLE_COMPRAS_LIMITE: el corte nunca puede pasar callado. */}
        {!isLoading && !error && response?.hasMore && (
          <div className="flex items-center gap-2 rounded-t-xl border-b border-warning/40 bg-warning/10 px-6 py-2 text-xs text-foreground shrink-0">
            <TriangleAlert className="size-3.5 shrink-0 text-warning" />
            Se muestran los primeros {count.toLocaleString("es-AR")} registros — filtrá por mes para ver el resto.
          </div>
        )}

        {!isLoading && !error && count > 0 && (
          // rounded-t-xl: en edición el modal pasa a overflow-visible y deja de
          // recortar sus esquinas; el fondo del thead sticky asomaría cuadrado.
          <div className={cn("overflow-y-auto overflow-x-hidden flex-1 min-h-0", filtered.length > 1 && "pb-2")}>
            <table className="text-xs w-full table-fixed">
              <thead className="sticky top-0 z-10 bg-popover">
                <tr className="border-b border-border/60">
                  <SortableTableHead
                    cols={cols}
                    sort={sort}
                    onSort={handleSortClick}
                    columnFilters={columnFields ? columnFilters : undefined}
                    onColumnFilter={columnFields ? setColumnFilter : undefined}
                  />
                  {/* Ancho de EditActionButtons (2 × w-6 + gap-1) + px-2: la columna
                      no cambia al pasar de lápiz+split (más angostos) a ✓/✕. */}
                  <th className="w-[4.25rem]" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => renderRow(item, contentEl))}
              </tbody>
            </table>
          </div>
        )}

        {saveError && (
          <div className="border-t border-destructive/30 px-6 py-2 text-xs text-destructive">{saveError}</div>
        )}
        {count > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-border/60 px-6 py-2.5 shrink-0 text-[11px]">
            <span className="text-muted-foreground/60">
              {hayFiltros
                ? `${filtered.length} de ${count} registro${count !== 1 ? "s" : ""}`
                : `${count} registro${count !== 1 ? "s" : ""}`}
              {periodoLabel ? ` — ${periodoLabel}` : ""}
            </span>
            {footerNote && <span className="text-muted-foreground">{footerNote}</span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
