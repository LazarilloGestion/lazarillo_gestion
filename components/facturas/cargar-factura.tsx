"use client";
import { useMemo, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { cubreFecha, hoyUTC } from "@/lib/apertura/estado-vigencia";
import type { Local } from "@/lib/types/domain";
import ModalNuevaCarga from "./modal-carga-factura";

export type Maestros = {
  proveedores: { id: number; codigo: string; nombre: string | null; razon: string | null; cuit: string | null }[];
  conceptos: { codigo: string; nombre: string; rubro: string }[];
  insumos: { codigo: string; nombre: string; medida: string; codCga: string | null; unit: number | null; alic: number | null }[];
};
export type PdvRef = { id: number; nombre: string; localId: number };

// Lo que necesita el modal de carga (alta, ver o editar): maestros, PDV y la
// regla de apertura activa de cada concepto para el PDV de gestión.
export function useCargaFactura(activo: boolean, pdvGestion: number | null | undefined, localGestion: number | null | undefined) {
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  // Los maestros cambian poco: 15 minutos sin volver a pedirlos (abrir el modal es instantáneo).
  const { data: maestros, isLoading } = useFetchQuery<Maestros>(["facturas-maestros"], activo ? "/api/facturas/maestros" : null, { staleTime: 15 * 60_000 });
  const { reglas } = useReglasApertura();
  const pdvsRef = useMemo<PdvRef[]>(
    () => (locales ?? []).flatMap((l) => l.puntosDeVenta.map((p) => ({ id: p.id, nombre: `${l.nombre} · ${p.nombre}`, localId: l.id }))),
    [locales],
  );
  // Regla de apertura activa y vigente hoy, a nivel concepto, con origen en este
  // PDV y destinos por PDV → reparto precargado (marca REGLA del prototipo).
  // Vigente en la fecha de la factura (si no viene, hoy).
  const reglaDe = (codigo: string | undefined, _pdvs?: unknown, fechaISO?: string) => {
    if (!codigo || pdvGestion == null) return null;
    const hoy = fechaISO && /^\d{4}-\d{2}-\d{2}$/.test(fechaISO) ? new Date(`${fechaISO}T00:00:00Z`) : hoyUTC();
    const r = reglas.find((x) => x.estado === "activa" && x.nivel === "concepto" && x.entidadId === codigo
      && (x.origenPuntoDeVentaId === pdvGestion || (x.origenPuntoDeVentaId == null && x.origenLocalId === localGestion))
      && cubreFecha(hoy, x, x.fechaDesde ? new Date(x.fechaDesde) : null, x.fechaHasta ? new Date(x.fechaHasta) : null) !== false);
    if (!r || r.destinos.some((d) => d.puntoDeVentaId == null)) return null;
    const rep = r.destinos.map((d) => ({ pdv: pdvsRef.find((p) => p.id === d.puntoDeVentaId)?.nombre, pct: Number(d.porcentaje) }));
    return rep.every((x) => x.pdv) ? rep : null;
  };
  return { maestros: isLoading ? undefined : maestros, pdvsRef, reglaDe, locales };
}

// Lo que cambia al cargar / editar / eliminar una factura.
export function refrescarCompras(queryClient: QueryClient) {
  for (const k of ["pivot", "detalle", "actualizado-al", "impagas", "cta-cte", "compra-lineas", "factura", "actividad", "sin-carga"]) {
    void queryClient.invalidateQueries({ queryKey: [k] });
  }
}

// Botón "+ Cargar Gastos" del Panel (a la izquierda de Impagas) y el modal de carga (Etapa 4, punto 1).
// Carga en el PDV elegido arriba (es el "PDV de gestión" del prototipo).
export function CargarFactura() {
  const { localId, pdvId } = useDashboard();
  const [abierto, setAbierto] = useState(false);
  const queryClient = useQueryClient();
  // Los maestros se piden al abrir el Panel, no al tocar el botón (Diego 27/10: se quedaba
  // "Cargando maestros…"): cuando se abre el modal ya están.
  const { maestros, pdvsRef, reglaDe } = useCargaFactura(true, pdvId, localId);
  const pdvActual = pdvsRef.find((p) => p.id === pdvId)?.nombre;

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
        maestros ? (
          <ModalNuevaCarga
            maestros={maestros}
            pdvsRef={pdvsRef}
            pdvActual={pdvActual}
            reglaDe={reglaDe}
            onCerrar={() => setAbierto(false)}
            onGuardado={(d: { comprobante: string; total: number; pago?: { id: number; aCuenta: number } | null; gastoVario?: boolean; concepto?: string }) => {
              setAbierto(false);
              const importe = `$ ${d.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
              if (d.gastoVario) {
                toast.success(d.pago ? "Gasto cargado y pagado" : "Gasto cargado (impago)", {
                  description: `${d.concepto ?? "Gastos Varios"} · ${importe}${d.pago ? ` · Pago Nº ${d.pago.id}` : ""}`,
                });
              } else {
                toast.success(d.pago ? "Factura cargada y pagada" : "Factura cargada", {
                  description: `${d.comprobante} · ${importe}${d.pago ? ` · Pago Nº ${d.pago.id}` : ""}${d.pago && d.pago.aCuenta > 0.004 ? ` · $ ${d.pago.aCuenta.toLocaleString("es-AR", { minimumFractionDigits: 2 })} a cuenta` : ""}`,
                });
              }
              refrescarCompras(queryClient);
            }}
          />
        ) : (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 text-sm text-white">Cargando maestros…</div>
        )
      )}
    </>
  );
}
