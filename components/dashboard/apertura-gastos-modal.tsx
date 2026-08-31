"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Plus, Pencil, Trash2, Ban, Inbox } from "lucide-react";
import { cn, fmtARS } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { validarSumaPorcentajes, encontrarDestinoDuplicado } from "@/lib/apertura/validaciones";
import type { ReglaAperturaDTO } from "@/lib/apertura/types";
import type { Local } from "@/lib/types/domain";
import type { TimelineReglaInput } from "@/lib/apertura/timeline-layout";
import { AperturaVigenciaSelector, type VigenciaFormState } from "./apertura-vigencia-selector";
import { AperturaDestinoRow, type DestinoFormState } from "./apertura-destino-row";
import { AperturaOrigenSelector, type OrigenFormState } from "./apertura-origen-selector";
import { AperturaTimeline } from "./apertura-timeline";

const VIGENCIA_VACIA: VigenciaFormState = {
  modo: "historico",
  fechaDesde: "",
  fechaHasta: "",
  extremosInclusivos: true,
  confirmarHistorico: false,
};

function destinoVacio(): DestinoFormState {
  return { localId: null, puntoDeVentaId: null, porcentaje: 0 };
}

const ORIGEN_VACIO: OrigenFormState = { localId: null, puntoDeVentaId: null };

function reglaAFormulario(regla: ReglaAperturaDTO): { vigencia: VigenciaFormState; destinos: DestinoFormState[] } {
  return {
    vigencia: {
      modo: regla.modo,
      fechaDesde: regla.fechaDesde?.slice(0, 10) ?? "",
      fechaHasta: regla.fechaHasta?.slice(0, 10) ?? "",
      extremosInclusivos: regla.extremosInclusivos,
      confirmarHistorico: regla.modo === "historico",
    },
    destinos: regla.destinos.map((d) => ({
      localId: d.localId,
      puntoDeVentaId: d.puntoDeVentaId,
      porcentaje: Number(d.porcentaje),
    })),
  };
}

function fechaISOConHora(fechaInput: string): string | null {
  return fechaInput ? new Date(`${fechaInput}T00:00:00Z`).toISOString() : null;
}

function resumenVigencia(regla: ReglaAperturaDTO): string {
  switch (regla.modo) {
    case "historico": return "Histórico completo";
    case "entre_fechas": return `${regla.fechaDesde?.slice(0, 10)} — ${regla.fechaHasta?.slice(0, 10)}`;
    case "desde_adelante": return `Desde ${regla.fechaDesde?.slice(0, 10)}`;
    case "desde_atras": return `Hasta ${regla.fechaHasta?.slice(0, 10)}`;
  }
}

export function AperturaGastosModal({
  conceptoCodigo,
  conceptoNombre,
  onClose,
}: {
  conceptoCodigo: string | null;
  conceptoNombre: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"lista" | "formulario">("lista");
  const [editando, setEditando] = useState<ReglaAperturaDTO | null>(null);
  const [vigencia, setVigencia] = useState<VigenciaFormState>(VIGENCIA_VACIA);
  const [destinos, setDestinos] = useState<DestinoFormState[]>([destinoVacio(), destinoVacio()]);
  const [origen, setOrigen] = useState<OrigenFormState>(ORIGEN_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [reglaAEliminar, setReglaAEliminar] = useState<ReglaAperturaDTO | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const { reglas: todasLasReglas, isLoading: reglasLoading, error: reglasError } = useReglasApertura();
  const reglasDelConcepto = useMemo(
    () => todasLasReglas.filter((r) => r.entidadId === conceptoCodigo).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)),
    [todasLasReglas, conceptoCodigo]
  );

  const { data: localesData } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const locales = localesData ?? [];

  // Nombres legibles para la línea de origen de cada card. Vive dentro del
  // componente porque depende de `locales` (lista remota).
  function resumenOrigen(regla: ReglaAperturaDTO): string {
    const local = locales.find((l) => l.id === regla.origenLocalId);
    if (regla.origenPuntoDeVentaId != null) {
      const pv = local?.puntosDeVenta.find((p) => p.id === regla.origenPuntoDeVentaId);
      return `Origen: ${pv?.nombre ?? "PDV"}`;
    }
    return `Origen: ${local?.nombre ?? "Local"} (todo el local)`;
  }

  // El origen queda "completo" con solo el local elegido — el punto de venta es
  // opcional ("todo el local"). El backend (validarOrigen) exige al menos uno de
  // los dos, así que sin local no hay preview ni guardado posible.
  const origenCompleto = origen.localId != null;

  const vigenciaCompletaParaPreview =
    conceptoCodigo != null &&
    origenCompleto &&
    (vigencia.modo === "historico" ||
      (vigencia.modo === "entre_fechas" && vigencia.fechaDesde !== "" && vigencia.fechaHasta !== "") ||
      (vigencia.modo === "desde_adelante" && vigencia.fechaDesde !== "") ||
      (vigencia.modo === "desde_atras" && vigencia.fechaHasta !== ""));

  // Al editar, la regla en curso va como reglaId: sus compras ya distribuidas
  // (esDistribuido = true) tienen que seguir contando en el total, si no el
  // preview muestra $0 justo para la plata de la que trata la regla.
  const previewUrl = vigenciaCompletaParaPreview
    ? `/api/apertura/reglas/preview-total?${new URLSearchParams({
        entidadId: conceptoCodigo!,
        ...(editando ? { reglaId: String(editando.id) } : {}),
        ...(origen.localId != null ? { origenLocalId: String(origen.localId) } : {}),
        ...(origen.puntoDeVentaId != null ? { origenPuntoDeVentaId: String(origen.puntoDeVentaId) } : {}),
        modo: vigencia.modo,
        ...(vigencia.fechaDesde ? { fechaDesde: fechaISOConHora(vigencia.fechaDesde)! } : {}),
        ...(vigencia.fechaHasta ? { fechaHasta: fechaISOConHora(vigencia.fechaHasta)! } : {}),
        extremosInclusivos: String(vigencia.extremosInclusivos),
      }).toString()}`
    : null;

  const { data: previewData, isLoading: previewLoading } = useFetchQuery<{ total: number }>(
    // editando?.id en la key: crear y editar consultan totales distintos para
    // la misma vigencia, no pueden compartir entrada de caché.
    ["apertura-preview-total", conceptoCodigo, editando?.id ?? null, origen.localId, origen.puntoDeVentaId, vigencia.modo, vigencia.fechaDesde, vigencia.fechaHasta, vigencia.extremosInclusivos],
    previewUrl,
    { staleTime: 10_000 }
  );
  // null (no 0) cuando el total todavía no se conoce — un 0 se leería como
  // dato real tanto en el agregado como en el $ de cada destino.
  const total = previewUrl !== null && !previewLoading ? previewData?.total ?? null : null;

  // Reset de estado local al cerrarse el modal (conceptoCodigo -> null) —
  // ajuste durante el render en vez de useEffect (evita la cascada de
  // renders que dispara react-hooks/set-state-in-effect; mismo patrón que
  // React docs recomienda para "resetear estado cuando cambia una prop").
  const [prevConceptoCodigo, setPrevConceptoCodigo] = useState(conceptoCodigo);
  if (conceptoCodigo !== prevConceptoCodigo) {
    setPrevConceptoCodigo(conceptoCodigo);
    if (conceptoCodigo === null) {
      setView("lista");
      setEditando(null);
      setErrorGuardar(null);
    }
  }

  function abrirFormularioNuevo() {
    setEditando(null);
    setVigencia(VIGENCIA_VACIA);
    setDestinos([destinoVacio(), destinoVacio()]);
    setOrigen(ORIGEN_VACIO);
    setErrorGuardar(null);
    setView("formulario");
  }

  function abrirFormularioEditar(regla: ReglaAperturaDTO) {
    const { vigencia: v, destinos: d } = reglaAFormulario(regla);
    setEditando(regla);
    setVigencia(v);
    setDestinos(d);
    setOrigen({ localId: regla.origenLocalId, puntoDeVentaId: regla.origenPuntoDeVentaId });
    setErrorGuardar(null);
    setView("formulario");
  }

  const sumaPorcentajes = destinos.reduce((acc, d) => acc + d.porcentaje, 0);
  const sumaValida = validarSumaPorcentajes(destinos);
  // Chequeo barato en cliente para no gastar un round-trip que el servidor va
  // a rechazar con 422 igual (la validación autoritativa sigue siendo la suya).
  const destinosCompletos = destinos.every((d) => d.localId !== null);
  const indiceDuplicado = encontrarDestinoDuplicado(destinos);
  const hayDuplicado = indiceDuplicado !== null;
  // Antes de que el usuario elija el primer local, la suma en rojo es ruido
  // (0% en un formulario vacío es esperable, no un error) — se activa recién
  // cuando hay algo cargado.
  const formularioTocado = destinos.some((d) => d.localId !== null);
  // Máximo de destinos sin superposición por local: o "todo el local" (1 fila)
  // o cada punto de venta por separado (puntosDeVenta.length filas) — nunca
  // ambos a la vez, así que el máximo real es el mayor de los dos, no la suma.
  const totalCombosPosibles = locales.reduce((acc, l) => acc + Math.max(1, l.puntosDeVenta.length), 0);
  const sinCombosDisponibles = locales.length > 0 && destinos.length >= totalCombosPosibles;
  const reactivaRegla = editando !== null && editando.estado === "inactiva";

  async function refetchDependientes() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["apertura-reglas"] }),
      // El total previsualizado depende de qué compras siguen elegibles
      // (condicionComprasElegibles filtra esDistribuido = false) — crear,
      // editar o eliminar una regla cambia eso para la misma ventana de
      // vigencia, así que el preview queda stale igual que pivot/detalle.
      // Sin params: matchea por prefijo todas las instancias cacheadas
      // (una por combinación de modo/fechas), no solo la que está montada.
      queryClient.invalidateQueries({ queryKey: ["apertura-preview-total"] }),
      queryClient.invalidateQueries({ queryKey: ["pivot"] }),
      queryClient.invalidateQueries({ queryKey: ["detalle"] }),
    ]);
  }

  async function handleGuardar() {
    if (conceptoCodigo === null) return;
    setGuardando(true);
    setErrorGuardar(null);
    let guardadoOk = false;
    try {
      // Solo se mandan las fechas que el modo usa: una fecha vieja que quedó
      // en el formulario tras cambiar de modo el backend la ignora, pero se
      // persiste igual en la regla y después deforma el eje de la línea de
      // tiempo (calcularSegmentosTimeline lee fechaDesde/fechaHasta de TODAS
      // las reglas del concepto).
      const usaFechaDesde = vigencia.modo === "entre_fechas" || vigencia.modo === "desde_adelante";
      const usaFechaHasta = vigencia.modo === "entre_fechas" || vigencia.modo === "desde_atras";

      const cuerpoComun = {
        origenLocalId: origen.localId,
        origenPuntoDeVentaId: origen.puntoDeVentaId,
        modo: vigencia.modo,
        fechaDesde: usaFechaDesde ? fechaISOConHora(vigencia.fechaDesde) : null,
        fechaHasta: usaFechaHasta ? fechaISOConHora(vigencia.fechaHasta) : null,
        extremosInclusivos: vigencia.extremosInclusivos,
        confirmarHistorico: vigencia.modo === "historico" ? vigencia.confirmarHistorico : undefined,
        destinos: destinos.map((d) => ({ localId: d.localId, puntoDeVentaId: d.puntoDeVentaId, porcentaje: d.porcentaje })),
      };

      const res = editando
        ? await fetch(`/api/apertura/reglas/${editando.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accion: "editar", ...cuerpoComun }),
          })
        : await fetch("/api/apertura/reglas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entidadId: conceptoCodigo, ...cuerpoComun }),
          });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        if (res.status === 409) {
          setErrorGuardar(payload?.error ?? "Esta vigencia se superpone con otra regla activa del mismo concepto.");
        } else if (res.status === 422) {
          setErrorGuardar(payload?.issues?.[0]?.message ?? "Datos inválidos.");
        } else {
          setErrorGuardar("No se pudo guardar. Intentá de nuevo.");
        }
        return;
      }

      guardadoOk = true;
    } catch {
      setErrorGuardar("No se pudo guardar. Intentá de nuevo.");
    } finally {
      setGuardando(false);
    }

    if (!guardadoOk) return;

    // Fuera del try de arriba a propósito: acá el servidor YA guardó. Si la
    // invalidación de caché falla, lo peor que pasa es que la pantalla quede
    // stale — reportarlo como "no se pudo guardar" sería mentir sobre una
    // mutación financiera ya persistida.
    setView("lista");
    notify.registroActualizado();
    try {
      await refetchDependientes();
    } catch (err) {
      console.error("[apertura] no se pudieron refrescar los datos tras guardar la regla", err);
    }
  }

  async function handleDesactivar(regla: ReglaAperturaDTO) {
    try {
      const res = await fetch(`/api/apertura/reglas/${regla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "desactivar" }),
      });
      if (!res.ok) throw new Error();
      await refetchDependientes();
      notify.registroActualizado();
    } catch {
      notify.errorActualizar(conceptoNombre);
    }
  }

  async function handleEliminar() {
    if (!reglaAEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/apertura/reglas/${reglaAEliminar.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await refetchDependientes();
      notify.registroActualizado();
      setReglaAEliminar(null);
    } catch {
      notify.errorActualizar(conceptoNombre);
    } finally {
      setEliminando(false);
    }
  }

  const reglasParaTimeline: TimelineReglaInput[] = [
    ...reglasDelConcepto
      .filter((r) => editando === null || r.id !== editando.id)
      .map((r) => ({
        id: r.id,
        estado: r.estado,
        modo: r.modo,
        fechaDesde: r.fechaDesde ? new Date(r.fechaDesde) : null,
        fechaHasta: r.fechaHasta ? new Date(r.fechaHasta) : null,
      })),
    ...(view === "formulario"
      ? [
          {
            id: "nueva" as const,
            estado: "nueva" as const,
            modo: vigencia.modo,
            fechaDesde: vigencia.fechaDesde ? new Date(vigencia.fechaDesde) : null,
            fechaHasta: vigencia.fechaHasta ? new Date(vigencia.fechaHasta) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <Dialog open={conceptoCodigo !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Apertura de gastos — {conceptoNombre}</DialogTitle>
          </DialogHeader>

          {view === "lista" && (
            <div className="flex flex-col gap-2">
              {reglasLoading ? (
                <div className="py-8 flex justify-center"><Spinner size="lg" /></div>
              ) : reglasError ? (
                <div className="py-8 text-center text-sm text-destructive">
                  Error: {reglasError.message}
                </div>
              ) : reglasDelConcepto.length === 0 ? (
                <div className="py-4 flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <Inbox className="w-8 h-8 opacity-40" />
                  Este concepto todavía no tiene reglas de apertura.
                </div>
              ) : (
                reglasDelConcepto.map((regla) => (
                  <div key={regla.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant={regla.estado === "activa" ? "default" : "outline"}>
                          {regla.estado === "activa" ? "Activa" : "Inactiva"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {regla.destinos.length} destino{regla.destinos.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground truncate">{resumenVigencia(regla)}</span>
                      <span className="text-xs text-muted-foreground truncate">{resumenOrigen(regla)}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="Editar"
                        onClick={() => abrirFormularioEditar(regla)}
                        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {regla.estado === "activa" && (
                        <button
                          type="button"
                          title="Desactivar"
                          onClick={() => handleDesactivar(regla)}
                          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Eliminar"
                        onClick={() => setReglaAEliminar(regla)}
                        className="flex h-7 w-7 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
              <button
                type="button"
                onClick={abrirFormularioNuevo}
                className="mt-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md border text-xs hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" /> Nueva regla
              </button>
            </div>
          )}

          {view === "formulario" && (
            <div className="flex flex-col gap-4">
              <AperturaOrigenSelector value={origen} locales={locales} onChange={setOrigen} />

              <AperturaVigenciaSelector value={vigencia} onChange={setVigencia} />

              {reactivaRegla && (
                <p className="text-xs text-muted-foreground">
                  Esta regla está inactiva: guardar la reactivará y volverá a distribuir las compras del período.
                </p>
              )}

              {reglasParaTimeline.length > 0 && <AperturaTimeline reglas={reglasParaTimeline} />}

              <Separator />

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Destinos</span>
                  <span>
                    Total del período:{" "}
                    {previewLoading ? "…" : total === null ? "—" : fmtARS(total)}
                  </span>
                </div>
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-2">
                  {destinos.map((d, i) => (
                    <AperturaDestinoRow
                      key={i}
                      destino={d}
                      locales={locales}
                      total={total}
                      otrosDestinos={destinos.filter((_, idx) => idx !== i)}
                      removable={destinos.length > 1}
                      onChange={(next) => setDestinos((prev) => prev.map((p, idx) => (idx === i ? next : p)))}
                      onRemove={() => setDestinos((prev) => prev.filter((_, idx) => idx !== i))}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setDestinos((prev) => [...prev, destinoVacio()])}
                    disabled={sinCombosDisponibles}
                    className="self-start inline-flex items-center gap-1 h-6 px-2 rounded text-xs text-muted-foreground hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <Plus className="h-3 w-3" /> Agregar destino
                  </button>
                  {sinCombosDisponibles && (
                    <p className="text-xs text-muted-foreground">
                      No hay más combinaciones de local / punto de venta disponibles.
                    </p>
                  )}
                </div>
                <p
                  className={cn(
                    "text-xs font-medium",
                    !formularioTocado ? "text-muted-foreground" : sumaValida ? "text-success" : "text-destructive"
                  )}
                >
                  Suma: {sumaPorcentajes.toFixed(2)}%{formularioTocado && !sumaValida ? " (debe dar 100%)" : ""}
                </p>
              </div>

              {errorGuardar && <p className="text-xs text-destructive">{errorGuardar}</p>}

              <div className="flex flex-col items-end gap-3 pt-2">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setView("lista")}
                    disabled={guardando}
                    className="h-8 px-3 rounded-md border text-xs hover:bg-muted disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleGuardar}
                    disabled={
                      guardando ||
                      !origenCompleto ||
                      !sumaValida ||
                      !destinosCompletos ||
                      hayDuplicado ||
                      (vigencia.modo === "historico" && !vigencia.confirmarHistorico)
                    }
                    className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-1.5"
                  >
                    {guardando && <Spinner size="sm" className="text-primary-foreground" />}
                    {reactivaRegla ? "Guardar y reactivar" : editando ? "Guardar cambios" : "Crear regla"}
                  </button>
                </div>
                {!guardando &&
                  (() => {
                    const motivos: string[] = [];
                    if (!origenCompleto) motivos.push("elegí el origen de la regla");
                    if (!destinosCompletos) motivos.push("completá el local de cada destino");
                    if (hayDuplicado) motivos.push("no repitas el mismo local/punto de venta en dos destinos");
                    if (vigencia.modo === "historico" && !vigencia.confirmarHistorico) motivos.push("confirmá aplicar a todo el histórico");
                    return motivos.length > 0 ? (
                      <p className="text-xs text-muted-foreground/70">Falta: {motivos.join(", ")}.</p>
                    ) : null;
                  })()}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={reglaAEliminar !== null}
        onOpenChange={(o) => { if (!o) setReglaAEliminar(null); }}
        title="Eliminar regla de apertura"
        description="Se revertirán todas las distribuciones ya generadas por esta regla. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        destructive
        confirming={eliminando}
        onConfirm={handleEliminar}
      />
    </>
  );
}
