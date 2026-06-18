"use client";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { fmtARS, normalize } from "@/lib/utils";
import { FileX2 } from "lucide-react";
import type { DetalleCompraLinea } from "@/lib/dashboard/types";

type Props = {
  compraId: string | null;
  comprobante: string | null;
  onClose: () => void;
};

export function CompraLineasModal({ compraId, comprobante, onClose }: Props) {
  const { data, isLoading, error } = useQuery<{ data: DetalleCompraLinea[] }>({
    queryKey: ["compra-lineas", compraId],
    queryFn: () => fetch(`/api/dashboard/compra-lineas/${compraId}`).then((r) => r.json()),
    enabled: compraId !== null,
    staleTime: 60_000,
  });

  const lineas = data?.data ?? [];

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
                  <th colSpan={7} className="px-6 pt-4 pb-3 text-left">
                    <DialogTitle className="text-base font-semibold">{normalize(comprobante) ?? "Comprobante"}</DialogTitle>
                  </th>
                </tr>
                <tr className="border-b border-border/60 text-xs text-muted-foreground font-medium">
                  <th className="px-4 py-2 text-left">Código</th>
                  <th className="px-4 py-2 text-left">Nombre</th>
                  <th className="px-4 py-2 text-right">Cant.</th>
                  <th className="px-4 py-2 text-left">Medida</th>
                  <th className="px-4 py-2 text-right">Neto</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-left">Observación</th>
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
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtARS(l.neto != null ? Number(l.neto) : null)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{fmtARS(l.totalIns != null ? Number(l.totalIns) : null)}</td>
                    <td className="px-4 py-2.5 truncate text-muted-foreground max-w-[180px]">{normalize(l.observac)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !error && lineas.length > 0 && (
          <div className="border-t border-border/60 px-6 py-2.5 shrink-0 text-[11px] text-muted-foreground/60">
            {lineas.length} línea{lineas.length !== 1 ? "s" : ""}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
