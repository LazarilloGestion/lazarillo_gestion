"use client";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Building2, Truck, Tag, Layers, ArrowDownUp } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fmtARS, fmtDate, normalize } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { buildComprasDetalleUrl } from "@/lib/dashboard/params";
import type { DetalleFilter, DetalleResponse, CompraDetalle } from "@/lib/dashboard/types";

// ─── Generic base ────────────────────────────────────────────────────────────

export interface ColDef {
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  right: boolean;
}

export function DetalleModalBase<T extends { rowId: string | number }>({
  title,
  filter,
  buildUrl,
  queryKey,
  cols,
  renderRow,
  onClose,
}: {
  title: string;
  filter: unknown | null;
  buildUrl: (f: NonNullable<typeof filter>) => string;
  queryKey: unknown[];
  cols: readonly ColDef[];
  renderRow: (item: T) => React.ReactNode[];
  onClose: () => void;
}) {
  const { data: response, isLoading, error } = useQuery<DetalleResponse<T>>({
    queryKey,
    queryFn: async () => {
      if (!filter) throw new Error("Filter requerido");
      const res = await fetch(buildUrl(filter));
      if (!res.ok) throw new Error("Error cargando detalle");
      return res.json() as Promise<DetalleResponse<T>>;
    },
    enabled: filter !== null,
    staleTime: 60_000,
    retry: 2,
    retryDelay: (i) => Math.min(1000 * 2 ** i, 30_000),
  });

  const data = response?.data;
  const hasMore = response?.hasMore ?? false;
  const count = data?.length ?? 0;

  return (
    <Dialog open={filter !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-fit sm:min-w-[480px] max-w-[92vw] sm:max-w-[92vw] max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">

        {(!isLoading && !error && count > 0) ? null : (
          <div className="px-6 pt-4 pb-3 shrink-0">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        )}
        {error && (
          <div className="py-12 text-center text-sm text-destructive">Error al cargar los datos.</div>
        )}
        {!isLoading && !error && count === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">Sin registros para la selección.</div>
        )}

        {!isLoading && !error && count > 0 && (
          <div className="overflow-auto flex-1 min-h-0">
            <table className="text-sm min-w-max w-full">
              <thead className="sticky top-0 z-10 bg-popover">
                <tr>
                  <th colSpan={cols.length} className="px-6 pt-4 pb-3 text-left">
                    <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
                  </th>
                </tr>
                <tr className="border-b border-border/60">
                  {cols.map(({ label, icon: Icon, color, bg, right }) => (
                    <th key={label} className={`px-4 py-3 ${right ? "text-right" : "text-left"}`}>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${bg}`}>
                          <Icon className={`h-3 w-3 ${color}`} />
                        </span>
                        {label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.map((item) => (
                  <tr key={item.rowId} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                    {renderRow(item).map((cell, i) => (
                      <td
                        key={i}
                        className={`px-4 py-2.5 ${cols[i]?.right ? "text-right tabular-nums font-medium whitespace-nowrap" : "truncate"}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(count > 0 || hasMore) && (
          <div className="border-t border-border/60 px-6 py-2.5 shrink-0 text-[11px] text-muted-foreground/60">
            {hasMore
              ? "Hay más de 500 registros — refiná los filtros para ver todos"
              : `${count} registro${count !== 1 ? "s" : ""}`}
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}

// ─── Compras ─────────────────────────────────────────────────────────────────

const COMPRAS_COLS: ColDef[] = [
  { label: "Fecha",     icon: CalendarDays, color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Local",     icon: Building2,    color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Proveedor", icon: Truck,        color: "text-emerald-500",      bg: "bg-emerald-500/10", right: false },
  { label: "Concepto",  icon: Tag,          color: "text-violet-500",       bg: "bg-violet-500/10",  right: false },
  { label: "Rubro",     icon: Layers,       color: "text-blue-500",         bg: "bg-blue-500/10",    right: false },
  { label: "Importe",   icon: ArrowDownUp,  color: "text-muted-foreground", bg: "bg-muted",          right: true  },
];

function renderComprasRow(c: CompraDetalle): React.ReactNode[] {
  return [
    fmtDate(c.fecha),
    normalize(c.local?.nombre),
    normalize(c.proveedor ?? c.proveedorRef?.nombre ?? c.proveedorRef?.razon),
    normalize(c.conceptoCaja?.nombre),
    normalize(c.conceptoCaja?.rubro?.nombre),
    fmtARS(c.importe != null ? Number(c.importe) : null),
  ];
}

export function DetalleModal({ filter, onClose }: { filter: DetalleFilter | null; onClose: () => void }) {
  return (
    <DetalleModalBase<CompraDetalle>
      title="Detalle de compras"
      filter={filter}
      buildUrl={(f) => buildComprasDetalleUrl(f as DetalleFilter)}
      queryKey={["detalle", filter]}
      cols={COMPRAS_COLS}
      renderRow={renderComprasRow}
      onClose={onClose}
    />
  );
}
