"use client";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Building2, Tag, Layers, ArrowDownUp, Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fmtARS, normalize } from "@/lib/utils";
import { buildVentasDetalleUrl } from "@/lib/dashboard/params";
import type { VentasDetalleFilter, DetalleResponse, VentaDetalle } from "@/lib/dashboard/types";

const COLS = [
  { label: "Fecha",       icon: CalendarDays, color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Local",       icon: Building2,    color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Tipo",        icon: Layers,       color: "text-blue-500",         bg: "bg-blue-500/10",    right: false },
  { label: "Cobro",       icon: Tag,          color: "text-violet-500",       bg: "bg-violet-500/10",  right: false },
  { label: "Turno",       icon: Users,        color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Comprobante", icon: Tag,          color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Mesa",        icon: Tag,          color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Mozo",        icon: Users,        color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Importe",     icon: ArrowDownUp,  color: "text-muted-foreground", bg: "bg-muted",          right: true  },
] as const;

export function VentasDetalleModal({
  filter,
  onClose,
}: {
  filter: VentasDetalleFilter | null;
  onClose: () => void;
}) {
  const { data: response, isLoading, error } = useQuery<DetalleResponse<VentaDetalle>>({
    queryKey: ["detalle-ventas", filter],
    queryFn: async () => {
      if (!filter) throw new Error("Filter requerido");
      const res = await fetch(buildVentasDetalleUrl(filter));
      if (!res.ok) throw new Error("Error cargando detalle");
      const json = await res.json();
      return json as DetalleResponse<VentaDetalle>;
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

        <div className="overflow-auto flex-1 min-h-0">
          <table className="text-sm min-w-max w-full">
            <thead className="sticky top-0 bg-popover">
              <tr>
                <th colSpan={COLS.length} className="px-6 pt-4 pb-3 text-left">
                  <DialogTitle className="text-base font-semibold">Detalle de ventas</DialogTitle>
                </th>
              </tr>
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
              {isLoading && (
                <tr>
                  <td colSpan={COLS.length} className="py-12 text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-muted-foreground/20 border-t-muted-foreground" />
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={COLS.length} className="py-12 text-center text-sm text-destructive">
                    Error al cargar los datos.
                  </td>
                </tr>
              )}
              {!isLoading && !error && count === 0 && (
                <tr>
                  <td colSpan={COLS.length} className="py-12 text-center text-sm text-muted-foreground">
                    Sin registros para la selección.
                  </td>
                </tr>
              )}
              {data?.map((v) => (
                <tr key={v.rowId} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap">
                    {v.fecha ? new Date(v.fecha).toLocaleDateString("es-AR") : "—"}
                  </td>
                  <td className="px-4 py-2.5 truncate">{normalize(v.local?.nombre)}</td>
                  <td className="px-4 py-2.5 truncate">{normalize(v.tipo)}</td>
                  <td className="px-4 py-2.5 truncate">{normalize(v.cobro)}</td>
                  <td className="px-4 py-2.5 truncate text-muted-foreground">{normalize(v.turno)}</td>
                  <td className="px-4 py-2.5 truncate text-muted-foreground">{normalize(v.comprobant)}</td>
                  <td className="px-4 py-2.5 truncate text-muted-foreground">{normalize(v.mesa)}</td>
                  <td className="px-4 py-2.5 truncate text-muted-foreground">{normalize(v.mozo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                    {fmtARS(v.importe != null ? Number(v.importe) : null)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
