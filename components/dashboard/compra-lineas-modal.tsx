"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { fmtARS, normalize } from "@/lib/utils";
import { ChevronUp, ChevronDown, ChevronsUpDown, FileX2 } from "lucide-react";
import { useSortState, type SortState } from "@/hooks/use-sort-state";
import { sortCompraLineas, totalComprobante, totalLinea } from "@/lib/dashboard/compra-lineas";
import type { DetalleCompraLinea } from "@/lib/dashboard/types";

type Props = {
  compraId: string | null;
  comprobante: string | null;
  onClose: () => void;
};

const COLS: { key: string; label: string; right: boolean }[] = [
  { key: "codigo",   label: "Código",      right: false },
  { key: "nombre",   label: "Nombre",      right: false },
  { key: "cantidad", label: "Cant.",       right: true  },
  { key: "medida",   label: "Medida",      right: false },
  { key: "neto",     label: "Neto",        right: true  },
  { key: "ivaTot",   label: "IVA",         right: true  },
  { key: "impNtTot", label: "Imp. int.",   right: true  },
  { key: "total",    label: "Total",       right: true  },
  { key: "observac", label: "Observación", right: false },
];

function toNum(v: string | number | null): number | null {
  return v != null ? Number(v) : null;
}

function SortHeader({ col, sort, onSort }: { col: (typeof COLS)[number]; sort: SortState; onSort: (key: string) => void }) {
  const active = sort?.key === col.key;
  return (
    <th
      className={`px-4 py-2 cursor-pointer select-none ${col.right ? "text-right" : "text-left"}`}
      onClick={() => onSort(col.key)}
    >
      <span className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""}`}>
        {col.label}
        {active
          ? sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
          : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </span>
    </th>
  );
}

export function CompraLineasModal({ compraId, comprobante, onClose }: Props) {
  const { data, isLoading, error } = useQuery<{ data: DetalleCompraLinea[] }>({
    queryKey: ["compra-lineas", compraId],
    queryFn: () => fetch(`/api/dashboard/compra-lineas/${compraId}`).then((r) => r.json()),
    enabled: compraId !== null,
    staleTime: 60_000,
  });
  const { sort, handleSortClick } = useSortState();

  const lineas = useMemo(() => {
    const raw = data?.data ?? [];
    return sort ? [...raw].sort((a, b) => sortCompraLineas(a, b, sort)) : raw;
  }, [data, sort]);
  const total = useMemo(() => totalComprobante(lineas), [lineas]);

  return (
    <Dialog open={compraId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] sm:w-fit sm:min-w-[520px] max-w-[92vw] sm:max-w-[92vw] max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">

        {isLoading && (
          <div className="px-6 pt-4 pb-3 shrink-0">
            <DialogTitle className="text-base font-semibold">{normalize(comprobante) ?? "Comprobante"}</DialogTitle>
          </div>
        )}
        {isLoading && <div className="flex items-center justify-center py-12"><Spinner size="lg" /></div>}

        {error && (
          <>
            <div className="px-6 pt-4 pb-3 shrink-0">
              <DialogTitle className="text-base font-semibold">{normalize(comprobante) ?? "Comprobante"}</DialogTitle>
            </div>
            <div className="py-12 text-center text-sm text-destructive">Error al cargar los datos.</div>
          </>
        )}

        {!isLoading && !error && lineas.length === 0 && (
          <>
            <div className="px-6 pt-4 pb-3 shrink-0">
              <DialogTitle className="text-base font-semibold">{normalize(comprobante) ?? "Comprobante"}</DialogTitle>
            </div>
            <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
              <FileX2 className="w-8 h-8 opacity-40" />
              <span className="text-sm">Sin detalle para este comprobante.</span>
            </div>
          </>
        )}

        {!isLoading && !error && lineas.length > 0 && (
          <div className="overflow-auto flex-1 min-h-0">
            <table className="text-sm min-w-max w-full">
              <thead className="sticky top-0 z-10 bg-popover">
                <tr>
                  <th colSpan={COLS.length} className="px-6 pt-4 pb-3 text-left">
                    <DialogTitle className="text-base font-semibold">{normalize(comprobante) ?? "Comprobante"}</DialogTitle>
                  </th>
                </tr>
                <tr className="border-b border-border/60 text-xs text-muted-foreground font-medium">
                  {COLS.map((col) => <SortHeader key={col.key} col={col} sort={sort} onSort={handleSortClick} />)}
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.rowId} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-2.5 truncate text-muted-foreground">{normalize(l.codigo)}</td>
                    <td className="px-4 py-2.5 truncate">{normalize(l.nombre)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {l.cantidad != null ? Number(l.cantidad).toLocaleString("es-AR") : "—"}
                    </td>
                    <td className="px-4 py-2.5 truncate text-muted-foreground">{normalize(l.medida)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtARS(toNum(l.neto))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtARS(toNum(l.ivaTot))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtARS(toNum(l.impNtTot))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{fmtARS(totalLinea(l))}</td>
                    <td className="px-4 py-2.5 truncate text-muted-foreground max-w-[180px]">{normalize(l.observac)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !error && lineas.length > 0 && (
          <div className="border-t border-border/60 px-6 py-2.5 shrink-0 flex items-center justify-between gap-4 text-[11px] text-muted-foreground/60">
            <span>{lineas.length} línea{lineas.length !== 1 ? "s" : ""}</span>
            {/* Es la factura completa (todas sus líneas), no solo el concepto
                desde el que se abrió — por eso puede no coincidir con la fila. */}
            <span className="tabular-nums">
              Total comprobante <span className="font-medium text-foreground">{fmtARS(total)}</span>
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
