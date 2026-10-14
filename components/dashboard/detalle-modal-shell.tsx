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
  sortFn?: (a: T, b: T, sort: SortState) => number;
  renderRow: (item: T, portalContainer: HTMLElement | null) => React.ReactNode;
  saveError?: string | null;
  isEditing?: boolean;
  footerNote?: string | null;
}

export function DetalleModalShell<T>({
  open,
  onClose,
  title,
  cols,
  queryKey,
  queryFn,
  searchFields,
  sortFn,
  renderRow,
  saveError,
  isEditing,
  footerNote,
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

  const { query, setQuery, filtered } = useTableSearch(data, searchFields);

  useEffect(() => { setQuery(""); }, [queryKey, setQuery]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        ref={setContentEl}
        showCloseButton={false}
        className={cn(
          "w-[calc(100vw-2rem)] sm:w-fit sm:min-w-[480px] max-w-[92vw] sm:max-w-[92vw] max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden",
          // Mientras se edita una fila, el combo de concepto puede necesitar desbordar
          // el modal (como ya hace el Select de rubro al portar a document.body).
          // Sin esto, overflow-hidden lo recorta contra el borde del modal.
          isEditing && "overflow-visible"
        )}
      >

        {(!isLoading && !error && count > 0) ? null : (
          <div className="px-6 pt-4 pb-3 shrink-0">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          </div>
        )}

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
          <div className={cn("overflow-auto flex-1 min-h-0 rounded-t-xl", filtered.length > 1 && "pb-2")}>
            <table className="text-xs min-w-max w-full">
              <thead className="sticky top-0 z-10 bg-popover">
                <tr>
                  <th colSpan={cols.length + 1} className="px-6 pt-4 pb-3 text-left">
                    <div className="flex items-center justify-between gap-4">
                      <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
                      {count > 1 && <SearchInput value={query} onChange={setQuery} className="w-44" />}
                    </div>
                  </th>
                </tr>
                <tr className="border-b border-border/60">
                  <SortableTableHead cols={cols} sort={sort} onSort={handleSortClick} />
                  <th className="w-8" />
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
              {query
                ? `${filtered.length} de ${count} registro${count !== 1 ? "s" : ""}`
                : `${count} registro${count !== 1 ? "s" : ""}`}
            </span>
            {footerNote && <span className="text-muted-foreground">{footerNote}</span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
