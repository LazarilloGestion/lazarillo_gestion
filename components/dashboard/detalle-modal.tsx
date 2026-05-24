"use client";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Building2, Truck, Tag, Layers, ArrowDownUp } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fmtARS, normalize } from "@/lib/utils";
import { buildComprasDetalleUrl } from "@/lib/dashboard/params";
import type { DetalleFilter, DetalleResponse, CompraDetalle } from "@/lib/dashboard/types";

export function DetalleModal({
  filter,
  onClose,
}: {
  filter: DetalleFilter | null;
  onClose: () => void;
}) {
  const { data: response, isLoading, error } = useQuery<DetalleResponse<CompraDetalle>>({
    queryKey: ["detalle", filter],
    queryFn: async () => {
      if (!filter) throw new Error("Filter requerido");
      const res = await fetch(buildComprasDetalleUrl(filter));
      if (!res.ok) throw new Error("Error cargando detalle");
      const json = await res.json();
      return json as DetalleResponse<CompraDetalle>;
    },
    enabled: filter !== null,
    staleTime: 60_000,
    retry: 2,
    retryDelay: (i) => Math.min(1000 * 2 ** i, 30_000),
  });

  const data = response?.data;
  const hasMore = response?.hasMore ?? false;
  const count = data?.length ?? 0;

  const COLS = [
    { label: "Fecha",     icon: CalendarDays, color: "text-muted-foreground", bg: "bg-muted",          right: false },
    { label: "Local",     icon: Building2,    color: "text-muted-foreground", bg: "bg-muted",          right: false },
    { label: "Proveedor", icon: Truck,        color: "text-emerald-500",      bg: "bg-emerald-500/10", right: false },
    { label: "Concepto",  icon: Tag,          color: "text-violet-500",       bg: "bg-violet-500/10",  right: false },
    { label: "Rubro",     icon: Layers,       color: "text-blue-500",         bg: "bg-blue-500/10",    right: false },
    { label: "Importe",   icon: ArrowDownUp,  color: "text-muted-foreground", bg: "bg-muted",          right: true  },
  ] as const;

  return (
    <Dialog open={filter !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-fit sm:min-w-[480px] max-w-[92vw] sm:max-w-[92vw] max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">

        {/* Header title — siempre visible fuera del scroll */}
        <div className="px-6 pt-4 pb-3 shrink-0">
          <DialogTitle className="text-base font-semibold">Detalle de compras</DialogTitle>
        </div>

        {/* Estados: loading / error / vacío — centrados respecto al modal, no a la tabla */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-muted-foreground/20 border-t-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="py-12 text-center text-sm text-destructive">
            Error al cargar los datos.
          </div>
        )}
        {!isLoading && !error && count === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Sin registros para la selección.
          </div>
        )}

        {!isLoading && !error && count > 0 && (
        <div className="overflow-auto flex-1 min-h-0">
          <table className="text-sm min-w-max w-full">
            <thead className="sticky top-0 bg-popover">
              <tr className="border-b border-border/60">
                {COLS.map(({ label, icon: Icon, color, bg, right }) => (
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
              {data?.map((c) => (
                <tr key={c.rowId} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap">
                    {c.fecha ? new Date(c.fecha).toLocaleDateString("es-AR") : "—"}
                  </td>
                  <td className="px-4 py-2.5 truncate">
                    {normalize(c.local?.nombre)}
                  </td>
                  <td className="px-4 py-2.5 truncate">
                    {normalize(c.proveedor ?? c.proveedorRef?.nombre ?? c.proveedorRef?.razon)}
                  </td>
                  <td className="px-4 py-2.5 truncate">
                    {normalize(c.conceptoCaja?.nombre)}
                  </td>
                  <td className="px-4 py-2.5 truncate">
                    {normalize(c.conceptoCaja?.rubro?.nombre)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                    {fmtARS(c.importe != null ? Number(c.importe) : null)}
                  </td>
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
