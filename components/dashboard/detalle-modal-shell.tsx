"use client";
import { useMemo, useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
  // Segunda línea bajo el título (ej. "Ramos Mejía · Bar").
  subtitle?: React.ReactNode;
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
  // Búsqueda también en el servidor (Año / Histórico pasan el tope de registros):
  // recibe lo tipeado en el buscador (con una pausa) para sumarlo a la consulta.
  onServerQuery?: (q: string) => void;
  // Clave que limpia buscador y filtros al cambiar (default: queryKey). Hace falta
  // separarla cuando el texto buscado forma parte de queryKey.
  resetKey?: unknown[];
  // Sección debajo de la tabla con los datos ya cargados (ej. la cuenta
  // corriente del proveedor cuando se abre un registro puntual).
  extra?: (data: T[]) => React.ReactNode;
  // Selección múltiple (checkbox por fila + "tildar todo" en el encabezado, sobre
  // lo filtrado). Las filas dibujan su propio checkbox como primera celda.
  seleccion?: {
    ids: Set<string>;
    idDe: (item: T) => string;
    onCambiar: (items: T[], tildar: boolean) => void;
    onLimpiar: () => void;
  };
  // Ancho de la columna de íconos de la fila (default: lápiz + apertura).
  anchoAcciones?: string;
}

// Render por tandas (velocidad, Diego 27/10): con 500 filas el modal tardaba ~1 s en
// aparecer y con 5.000, ~8 s, y cada ✎ redibujaba todas. Se dibujan las primeras
// TANDA filas y se suman más al acercarse al final del scroll. Orden, buscador,
// filtros, totales y "tildar todo" siguen trabajando sobre la lista completa.
export const TANDA = 100;

export function DetalleModalShell<T>({
  open,
  onClose,
  title,
  subtitle,
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
  onServerQuery,
  resetKey,
  extra,
  seleccion,
  anchoAcciones = "w-[4.25rem]",
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
    // Al buscar en el servidor no se vacía la tabla mientras llega la respuesta.
    placeholderData: onServerQuery ? keepPreviousData : undefined,
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

  const claveReset = resetKey ?? queryKey;
  useEffect(() => { clearFilters(); }, [claveReset, clearFilters]);

  // Cuántas filas se dibujan. Vuelve a la primera tanda al cambiar de consulta, orden o
  // filtros (no al refrescar tras guardar: así no salta el scroll).
  const [visibles, setVisibles] = useState(TANDA);
  const claveTanda = JSON.stringify([claveReset, sort, query, columnFilters]);
  const [claveTandaPrevia, setClaveTandaPrevia] = useState(claveTanda);
  if (claveTandaPrevia !== claveTanda) {
    setClaveTandaPrevia(claveTanda);
    setVisibles(TANDA);
  }
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const finRef = useRef<HTMLTableRowElement | null>(null);
  const quedan = filtered.length > visibles;
  useEffect(() => {
    const fin = finRef.current;
    if (!quedan || !fin) return;
    const obs = new IntersectionObserver(
      (entradas) => { if (entradas.some((e) => e.isIntersecting)) setVisibles((v) => v + TANDA); },
      { root: scrollRef.current, rootMargin: "800px 0px" },
    );
    obs.observe(fin);
    return () => obs.disconnect();
  }, [quedan, visibles]);
  useEffect(() => {
    if (!onServerQuery) return;
    const t = setTimeout(() => onServerQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query, onServerQuery]);

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
          // Con sección extra el alto queda fijo: la tabla toma lo justo y el resto es de la sección.
          extra && "h-[85vh]",
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
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
              {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
            </div>
            {headerControls}
          </div>
          {/* Con texto escrito el buscador queda visible también mientras carga otro período. */}
          {!error && (!!query || (!isLoading && count > 1)) && <SearchInput value={query} onChange={setQuery} className="w-44 shrink-0" />}
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
          <div ref={scrollRef} className={cn("overflow-y-auto overflow-x-hidden min-h-0", extra ? "flex-none max-h-[40%]" : "flex-1", filtered.length > 1 && "pb-2")}>
            <table className="text-xs w-full table-fixed">
              <thead className="sticky top-0 z-10 bg-popover">
                <tr className="border-b border-border/60">
                  {seleccion && (() => {
                    const ids = [...new Set(filtered.map(seleccion.idDe))];
                    const tildados = ids.filter((id) => seleccion.ids.has(id)).length;
                    return (
                      <th className="w-8 pl-3">
                        <input
                          type="checkbox"
                          aria-label="Tildar todos"
                          className="size-3.5 accent-zinc-900 dark:accent-white align-middle cursor-pointer"
                          checked={ids.length > 0 && tildados === ids.length}
                          ref={(el) => { if (el) el.indeterminate = tildados > 0 && tildados < ids.length; }}
                          onChange={(e) => seleccion.onCambiar(filtered, e.target.checked)}
                        />
                      </th>
                    );
                  })()}
                  <SortableTableHead
                    cols={cols}
                    sort={sort}
                    onSort={handleSortClick}
                    columnFilters={columnFields ? columnFilters : undefined}
                    onColumnFilter={columnFields ? setColumnFilter : undefined}
                  />
                  {/* Ancho de EditActionButtons (2 × w-6 + gap-1) + px-2: la columna
                      no cambia al pasar de lápiz+split (más angostos) a ✓/✕. */}
                  <th className={anchoAcciones} />
                </tr>
              </thead>
              <tbody>
                {(quedan ? filtered.slice(0, visibles) : filtered).map((item) => renderRow(item, contentEl))}
                {quedan && (
                  <tr ref={finRef} aria-hidden>
                    <td colSpan={cols.length + (seleccion ? 2 : 1)} className="py-3 text-center text-[11px] text-muted-foreground/60">
                      Cargando más registros…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {extra && !isLoading && !error && rawData && (
          <div className="flex-1 min-h-0 border-t-4 border-zinc-100 dark:border-zinc-800 flex flex-col">{extra(rawData)}</div>
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
              {seleccion && seleccion.ids.size > 0 && (
                <>
                  {" · "}
                  <span className="text-foreground font-medium">{seleccion.ids.size} tildado{seleccion.ids.size !== 1 ? "s" : ""}</span>
                  {" · "}
                  <button type="button" className="underline hover:text-foreground" onClick={seleccion.onLimpiar}>
                    destildar
                  </button>
                </>
              )}
            </span>
            {footerNote && <span className="text-muted-foreground">{footerNote}</span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
