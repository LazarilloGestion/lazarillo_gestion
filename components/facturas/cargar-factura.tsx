"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { cubreFecha, hoyUTC } from "@/lib/apertura/estado-vigencia";
import type { Local } from "@/lib/types/domain";
import ModalNuevaCarga from "./modal-carga-factura";

type Maestros = {
  proveedores: { id: number; codigo: string; nombre: string | null; razon: string | null; cuit: string | null }[];
  conceptos: { codigo: string; nombre: string; rubro: string }[];
  insumos: { codigo: string; nombre: string; medida: string; codCga: string | null; unit: number | null; alic: number | null }[];
};
type PdvRef = { id: number; nombre: string; localId: number };

// Botón "+ Cargar Gastos" del Panel (a la izquierda de Impagas) y el modal de carga (Etapa 4, punto 1).
// Carga en el PDV elegido arriba (es el "PDV de gestión" del prototipo).
export function CargarFactura() {
  const { localId, pdvId } = useDashboard();
  const [abierto, setAbierto] = useState(false);
  const queryClient = useQueryClient();
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const { data: maestros, isLoading } = useFetchQuery<Maestros>(["facturas-maestros"], abierto ? "/api/facturas/maestros" : null);
  const { reglas } = useReglasApertura();

  const pdvsRef = useMemo<PdvRef[]>(
    () => (locales ?? []).flatMap((l) => l.puntosDeVenta.map((p) => ({ id: p.id, nombre: `${l.nombre} · ${p.nombre}`, localId: l.id }))),
    [locales],
  );
  const pdvActual = pdvsRef.find((p) => p.id === pdvId)?.nombre;

  // Regla de apertura activa y vigente hoy, a nivel concepto, con origen en este
  // PDV y destinos por PDV → reparto precargado (marca REGLA del prototipo).
  const reglaDe = (codigo: string | undefined) => {
    if (!codigo || pdvId == null) return null;
    const hoy = hoyUTC();
    const r = reglas.find((x) => x.estado === "activa" && x.nivel === "concepto" && x.entidadId === codigo
      && (x.origenPuntoDeVentaId === pdvId || (x.origenPuntoDeVentaId == null && x.origenLocalId === localId))
      && cubreFecha(hoy, x, x.fechaDesde ? new Date(x.fechaDesde) : null, x.fechaHasta ? new Date(x.fechaHasta) : null) !== false);
    if (!r || r.destinos.some((d) => d.puntoDeVentaId == null)) return null;
    const rep = r.destinos.map((d) => ({ pdv: pdvsRef.find((p) => p.id === d.puntoDeVentaId)?.nombre, pct: Number(d.porcentaje) }));
    return rep.every((x) => x.pdv) ? rep : null;
  };

  const puede = localId != null && pdvId != null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        disabled={!puede}
        title={puede ? "Cargar una factura en este PDV" : "Elegí un local y un PDV para cargar"}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
      >
        <Plus className="h-3.5 w-3.5" /> Cargar Gastos
      </button>
      {abierto && puede && (
        maestros && !isLoading ? (
          <ModalNuevaCarga
            maestros={maestros}
            pdvsRef={pdvsRef}
            pdvActual={pdvActual}
            reglaDe={reglaDe}
            onCerrar={() => setAbierto(false)}
            onGuardado={(d: { comprobante: string; total: number }) => {
              setAbierto(false);
              toast.success("Factura cargada", { description: `${d.comprobante} · $ ${d.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}` });
              for (const k of ["pivot", "detalle", "actualizado-al", "impagas", "cta-cte"]) void queryClient.invalidateQueries({ queryKey: [k] });
            }}
          />
        ) : (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 text-sm text-white">Cargando maestros…</div>
        )
      )}
    </>
  );
}
