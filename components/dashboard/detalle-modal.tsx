"use client";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Building2, Truck, Tag, Layers, ArrowDownUp } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fmtARS, normalize } from "@/lib/utils";
import type { DetalleFilter, CompraDetalle } from "@/lib/dashboard/types";

function buildUrl(filter: DetalleFilter): string {
  const params = new URLSearchParams({ year: String(filter.year) });
  if (filter.localId) params.set("localId", String(filter.localId));
  if (filter.pdvId) params.set("pdvId", String(filter.pdvId));
  if (filter.mes) params.set("mes", String(filter.mes));
  if (filter.conceptoCodigo) params.set("conceptoCodigo", filter.conceptoCodigo);
  if (filter.proveedorId) params.set("proveedorId", String(filter.proveedorId));
  if (filter.rubroCodigo) params.set("rubroCodigo", filter.rubroCodigo);
  return `/api/dashboard/detalle?${params}`;
}

export function DetalleModal({
  filter,
  onClose,
}: {
  filter: DetalleFilter | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery<CompraDetalle[]>({
    queryKey: ["detalle", filter],
    queryFn: async () => {
      if (!filter) throw new Error("Filter requerido");
      const res = await fetch(buildUrl(filter));
      if (!res.ok) throw new Error("Error cargando detalle");
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error("Respuesta inesperada del servidor");
      return json as CompraDetalle[];
    },
    enabled: filter !== null,
  });

  const count = data?.length ?? 0;

  return (
    <Dialog open={filter !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-fit min-w-[480px] max-w-[92vw] sm:max-w-[92vw] max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">

        {/* Body */}
        <div className="overflow-y-auto flex-1 min-h-0 min-w-max">
          {isLoading && (
            <>
              <div className="px-6 py-4 border-b border-border/60 shrink-0">
                <DialogTitle className="text-base font-semibold">Detalle de compras</DialogTitle>
              </div>
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-muted-foreground/20 border-t-muted-foreground" />
              </div>
            </>
          )}
          {error && (
            <>
              <div className="px-6 py-4 border-b border-border/60 shrink-0">
                <DialogTitle className="text-base font-semibold">Detalle de compras</DialogTitle>
              </div>
              <p className="text-sm text-destructive py-12 text-center">Error al cargar los datos.</p>
            </>
          )}
          {!isLoading && !error && count === 0 && (
            <>
              <div className="px-6 py-4 border-b border-border/60 shrink-0">
                <DialogTitle className="text-base font-semibold">Detalle de compras</DialogTitle>
              </div>
              <p className="text-sm text-muted-foreground py-12 text-center">Sin registros para la selección.</p>
            </>
          )}

          {count > 0 && (
            <table className="text-sm">

              <thead className="sticky top-0 bg-popover">
                <tr>
                  <th colSpan={6} className="px-6 pt-4 pb-3 text-left">
                    <DialogTitle className="text-base font-semibold">Detalle de compras</DialogTitle>
                  </th>
                </tr>
                <tr className="border-b border-border/60">
                  {(
                    [
                      { label: "Fecha",     icon: CalendarDays, color: "text-muted-foreground", bg: "bg-muted",          right: false },
                      { label: "Local",     icon: Building2,    color: "text-muted-foreground", bg: "bg-muted",          right: false },
                      { label: "Proveedor", icon: Truck,        color: "text-emerald-500",      bg: "bg-emerald-500/10", right: false },
                      { label: "Concepto",  icon: Tag,          color: "text-violet-500",       bg: "bg-violet-500/10",  right: false },
                      { label: "Rubro",     icon: Layers,       color: "text-blue-500",         bg: "bg-blue-500/10",    right: false },
                      { label: "Importe",   icon: ArrowDownUp,  color: "text-muted-foreground", bg: "bg-muted",          right: true  },
                    ] as const
                  ).map(({ label, icon: Icon, color, bg, right }) => (
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
                {data!.map((c) => (
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
          )}
        </div>

        {/* Footer */}
        {count > 0 && (
          <div className="border-t border-border/60 px-6 py-2.5 shrink-0 text-[11px] text-muted-foreground/60">
            {count === 500 ? "Mostrando los primeros 500 registros" : `${count} registro${count !== 1 ? "s" : ""}`}
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
