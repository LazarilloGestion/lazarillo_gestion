"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import type { FacturaInput } from "@/lib/facturas/armar";
import { CompraLineasModal } from "@/components/dashboard/compra-lineas-modal";
import ModalNuevaCarga, { edeDesdeFactura } from "./modal-carga-factura";
import { useCargaFactura, refrescarCompras } from "./cargar-factura";

type Respuesta =
  | { noEsFactura: true }
  | {
      noEsFactura?: false; rowId: string; origen: "lazarillo" | "maxirest"; editable: boolean; estimado: boolean;
      proveedorId: number | null; factura: FacturaInput; totalFilas: number; cargadaPor?: string | null; cargadaEn?: string; editadaEn?: string;
    };

const fecha = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("es-AR") : "");

// Ver una factura con el mismo formato de la carga (Etapa 4, punto 3): desde ahí,
// si es de Lazarillo, Editar o Eliminar. Si la fila no es una factura (gasto
// vario, sueldo) queda el detalle de líneas de siempre.
// vistaInicial "repetir": abre directo la carga de una factura NUEVA con esta estructura.
export function VerFactura({ rowId, detalle, onClose, vistaInicial = "ver" }: {
  rowId: string | null; detalle: string | null; onClose: () => void; vistaInicial?: "ver" | "repetir";
}) {
  const [vista, setVista] = useState<"ver" | "editar" | "repetir">(vistaInicial);
  const queryClient = useQueryClient();
  const { data, isLoading } = useFetchQuery<Respuesta>(["factura", rowId], rowId ? `/api/facturas/${rowId}` : null);
  const fa = data && !data.noEsFactura ? data : null;
  const pdvGestion = fa?.factura.registros[0]?.puntoDeVentaId ?? null;
  const { maestros, pdvsRef, reglaDe } = useCargaFactura(!!fa, pdvGestion, pdvGestion != null ? undefined : null);
  const pdvActual = pdvsRef.find((p) => p.id === pdvGestion)?.nombre;

  if (!rowId) return null;
  if (data?.noEsFactura) return <CompraLineasModal compraId={rowId} comprobante={detalle} onClose={onClose} />;

  const cerrar = () => { setVista(vistaInicial); onClose(); };
  const ede = fa && maestros ? edeDesdeFactura(fa.rowId, fa.factura, { maestros, pdvsRef }) : null;
  const aviso = !fa ? null
    : fa.origen === "maxirest"
      ? `Cargada desde MaxiRest: se ve con el formato de la carga, pero se modifica en MaxiRest.${fa.estimado ? " Sin detalle de insumos (informe 25): el neto y el IVA se estiman al 21% sobre el importe." : ""}`
      : `Cargada en Lazarillo${fa.cargadaPor ? ` por ${fa.cargadaPor}` : ""}${fa.cargadaEn ? ` el ${fecha(fa.cargadaEn)}` : ""}${fa.editadaEn && fa.cargadaEn && fa.editadaEn.slice(0, 16) !== fa.cargadaEn.slice(0, 16) ? ` · editada el ${fecha(fa.editadaEn)}` : ""}.`;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) cerrar(); }}>
      <DialogContent showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[min(1120px,96vw)] max-w-[96vw] sm:max-w-[1120px] max-h-[92vh] overflow-auto p-0 gap-0">
        <DialogTitle className="sr-only">{detalle ?? "Factura"}</DialogTitle>
        {isLoading || !fa || !maestros ? (
          <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>
        ) : vista === "repetir" ? (
          <ModalNuevaCarga
            key="repetir"
            embebido
            vista="nueva"
            ctx={{ repetirDe: ede }}
            maestros={maestros}
            pdvsRef={pdvsRef}
            pdvActual={pdvActual}
            reglaDe={reglaDe}
            onCerrar={vistaInicial === "repetir" ? cerrar : () => setVista("ver")}
            onGuardado={(d: { comprobante: string; total: number }) => {
              toast.success("Factura cargada", { description: `${d.comprobante} · $ ${d.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}` });
              refrescarCompras(queryClient);
              cerrar();
            }}
          />
        ) : (
          <ModalNuevaCarga
            key={vista}
            embebido
            vista={vista}
            ctx={{ editarDe: ede }}
            editRowId={fa.rowId}
            editable={fa.editable}
            aviso={aviso}
            maestros={maestros}
            pdvsRef={pdvsRef}
            pdvActual={pdvActual}
            reglaDe={reglaDe}
            onEditar={() => setVista("editar")}
            onRepetir={() => setVista("repetir")}
            onCerrar={vista === "editar" ? () => setVista("ver") : cerrar}
            onGuardado={(d: { comprobante: string; total: number }) => {
              toast.success("Factura modificada", { description: `${d.comprobante} · $ ${d.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}` });
              refrescarCompras(queryClient);
              cerrar();
            }}
            onEliminado={() => {
              toast.success("Factura eliminada");
              refrescarCompras(queryClient);
              cerrar();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
