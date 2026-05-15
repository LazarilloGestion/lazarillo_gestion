"use client";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DetalleFilter } from "@/lib/dashboard/types";

type CompraDetalle = {
  rowId: string;
  fecha: string | null;
  importe: number | null;
  proveedor: string | null;
  proveedorRef: { nombre: string | null; razon: string | null } | null;
  local: { nombre: string } | null;
  puntoDeVenta: { nombre: string } | null;
  conceptoCaja: {
    nombre: string;
    rubro: { nombre: string } | null;
  } | null;
};

const fmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

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
  const { data, isLoading } = useQuery({
    queryKey: ["detalle", filter],
    queryFn: async () => {
      const res = await fetch(buildUrl(filter!));
      if (!res.ok) throw new Error("Error cargando detalle");
      return res.json() as Promise<CompraDetalle[]>;
    },
    enabled: filter !== null,
  });

  return (
    <Dialog
      open={filter !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Detalle de compras</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1">
          {isLoading && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Cargando...
            </p>
          )}

          {data && data.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Sin registros para la selección.
            </p>
          )}

          {data && data.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="py-2 pr-4 font-medium">Fecha</th>
                    <th className="py-2 pr-4 font-medium">Local</th>
                    <th className="py-2 pr-4 font-medium">Proveedor</th>
                    <th className="py-2 pr-4 font-medium">Concepto</th>
                    <th className="py-2 pr-4 font-medium">Rubro</th>
                    <th className="py-2 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr
                      key={c.rowId}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="py-1.5 pr-4">
                        {c.fecha
                          ? new Date(c.fecha).toLocaleDateString("es-AR")
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {c.local?.nombre ?? "—"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {c.proveedor ??
                          c.proveedorRef?.nombre ??
                          c.proveedorRef?.razon ??
                          "—"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {c.conceptoCaja?.nombre ?? "—"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {c.conceptoCaja?.rubro?.nombre ?? "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {c.importe != null ? fmt.format(c.importe) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.length === 500 && (
                <p className="text-xs text-muted-foreground mt-3">
                  Mostrando los primeros 500 registros.
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
