"use client";
import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Plus, Pencil, Trash2, Ban, Inbox } from "lucide-react";
import { cn, fmtARS } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { validarSumaPorcentajes, encontrarDestinoDuplicado } from "@/lib/apertura/validaciones";
import { autocompletarDestino } from "@/lib/apertura/autocompletar-destino";
import type { ReglaAperturaDTO } from "@/lib/apertura/types";
import type { NivelRegla } from "@/lib/apertura/schemas";
import type { Local } from "@/lib/types/domain";
import { AperturaVigenciaSelector, type VigenciaFormState } from "./apertura-vigencia-selector";
import { AperturaDestinoRow, type DestinoFormState } from "./apertura-destino-row";
import { AperturaOrigenSelector, type OrigenFormState } from "./apertura-origen-selector";
import { describirOrigen } from "@/lib/apertura/descripcion-origen";
import {
  estadoVigenciaRegla,
  resumenVigencia,
  ordenarReglas,
  hayReglaVigente,
  formatPorcentaje,
  ETIQUETA_ESTADO,
  type EstadoVigenciaRegla,
} from "@/lib/apertura/estado-vigencia";

const NIVEL_LABELS: Record<NivelRegla, string> = {
  concepto: "Concepto",
  proveedor: "Proveedor",
  registro: "Registro individual",
};

const VIGENCIA_VACIA: VigenciaFormState = {
  modo: "historico",
  fechaDesde: "",
  fechaHasta: "",
  extremosInclusivos: true,
  confirmarHistorico: false,
};

// nivel "registro" nunca tiene vigencia propia — apunta a una sola compra
// puntual, aplica siempre. Se modela como "histórico completo" ya confirmado,
// sin exponer la sección de vigencia en el formulario (ver más abajo, oculta
// para este nivel).
const VIGENCIA_REGISTRO: VigenciaFormState = {
  modo: "historico",
  fechaDesde: "",
  fechaHasta: "",
  extremosInclusivos: true,
  confirmarHistorico: true,
};

function destinoVacio(): DestinoFormState {
  return { localId: null, puntoDeVentaId: null, porcentaje: 0 };
}

// Una regla nueva arranca con un único destino al 100%, precargado con el
// mismo local/PDV que el origen: el caso más común es aperturar dentro del
// mismo local y así se guarda sin tocar nada más que el local/PDV real si
// difiere. Al agregar un destino siguiente, restanteDePorcentaje() completa
// el % que falta para no arrancar en 0%.
function destinosIniciales(origenLocalId: number | null, origenPdvId: number | null): DestinoFormState[] {
  return [{ localId: origenLocalId, puntoDeVentaId: origenPdvId, porcentaje: 100 }];
}

function restanteDePorcentaje(destinos: DestinoFormState[]): number {
  return Math.max(0, 100 - destinos.reduce((acc, d) => acc + d.porcentaje, 0));
}

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

// Estado a la vista de cada regla (vigente / vencida / próxima / inactiva),
// calculado contra HOY — ver lib/apertura/estado-vigencia.ts. Verde solo la
// que cubre hoy; vencida e inactiva atenuadas para que la vigente resalte.
const ESTADO_BADGE: Record<EstadoVigenciaRegla, { variant: "default" | "secondary" | "outline"; className?: string }> = {
  vigente: { variant: "default", className: "bg-emerald-600 text-white" },
  proxima: { variant: "secondary" },
  vencida: { variant: "outline", className: "text-muted-foreground" },
  inactiva: { variant: "outline", className: "text-muted-foreground line-through" },
};

const AVISO_SIN_VIGENTE: Record<NivelRegla, string> = {
  proveedor: "Ninguna regla vigente — los gastos nuevos de este proveedor no se aperturan.",
  concepto: "Ninguna regla vigente — los gastos nuevos de este concepto no se aperturan.",
  registro: "Ninguna regla vigente — este registro no se apertura.",
};

export function AperturaGastosModal({
  nivel,
  entidadId,
  entidadNombre,
  origenLocalId,
  origenPdvId,
  onClose,
}: {
  nivel: NivelRegla;
  entidadId: string | null;
  entidadNombre: string;
  // Origen de una regla nueva: viene fijo del filtro del dashboard, no se edita
  // desde el modal. Al editar una regla existente sí se usa el selector.
  origenLocalId: number | null;
  origenPdvId: number | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"lista" | "formulario">("lista");
  const [editando, setEditando] = useState<ReglaAperturaDTO | null>(null);
  const [vigencia, setVigencia] = useState<VigenciaFormState>(VIGENCIA_VACIA);
  const [destinos, setDestinos] = useState<DestinoFormState[]>(() => destinosIniciales(origenLocalId, origenPdvId));
  const [origen, setOrigen] = useState<OrigenFormState>({ localId: origenLocalId, puntoDeVentaId: origenPdvId });
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [reglaAEliminar, setReglaAEliminar] = useState<ReglaAperturaDTO | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const { reglas: todasLasReglas, isLoading: reglasLoading, error: reglasError } = useReglasApertura();
  const reglasDeLaEntidad = useMemo(
    () => ordenarReglas(todasLasReglas.filter((r) => r.nivel === nivel && r.entidadId === entidadId)),
    [todasLasReglas, nivel, entidadId]
  );
  const sinReglaVigente = reglasDeLaEntidad.length > 0 && !hayReglaVigente(reglasDeLaEntidad);

  const { data: localesData } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const locales = localesData ?? [];

  // Nombres legibles para la línea de origen de cada card. Vive dentro del
  // componente porque depende de `locales` (lista remota).
  function resumenOrigen(regla: ReglaAperturaDTO): string {
    return `Origen: ${describirOrigen(locales, regla.origenLocalId, regla.origenPuntoDeVentaId)}`;
  }

  // Destinos un PDV por renglón con su porcentaje alineado (antes la card
  // decía "2 destinos"; luego iban en una sola línea separados por "·", que
  // con 3 destinos se leía mal — Diego, 21/10/2026). El destino que coincide
  // con el origen de la regla lleva el chip "origen" en vez de repetir el
  // nombre en un renglón aparte; ese renglón solo aparece si el origen no
  // está entre los destinos (regla que manda el 100% a otro lado).
  function esDestinoOrigen(regla: ReglaAperturaDTO, d: ReglaAperturaDTO["destinos"][number]): boolean {
    return d.localId === regla.origenLocalId && d.puntoDeVentaId === regla.origenPuntoDeVentaId;
  }
  function renderDestinos(regla: ReglaAperturaDTO) {
    const origenEntreDestinos = regla.destinos.some((d) => esDestinoOrigen(regla, d));
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_3.25rem_auto] items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        {regla.destinos.map((d) => (
          <Fragment key={d.id}>
            <span className="truncate">{describirOrigen(locales, d.localId, d.puntoDeVentaId)}</span>
            <span className="text-right tabular-nums text-foreground">{formatPorcentaje(d.porcentaje)}%</span>
            <span>
              {esDestinoOrigen(regla, d) && (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground">origen</Badge>
              )}
            </span>
          </Fragment>
        ))}
        {!origenEntreDestinos && <span className="col-span-3 truncate">{resumenOrigen(regla)}</span>}
      </div>
    );
  }

  // El origen exige local Y punto de venta — "todo el local" se sacó de uso
  // (sesión 19-sep-2026, ambigüedad de negocio). El backend (validarOrigen)
  // rechaza un origen sin PDV, así que sin PDV no hay preview ni guardado posible.
  const origenCompleto = origen.localId != null && origen.puntoDeVentaId != null;

  const vigenciaCompletaParaPreview =
    entidadId != null &&
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
        nivel,
        entidadId: entidadId!,
        ...(editando ? { reglaId: String(editando.id) } : {}),
        ...(origen.localId != null ? { origenLocalId: String(origen.localId) } : {}),
        ...(origen.puntoDeVentaId != null ? { origenPuntoDeVentaId: String(origen.puntoDeVentaId) } : {}),
        modo: vigencia.modo,
        ...(vigencia.fechaDesde ? { fechaDesde: fechaISOConHora(vigencia.fechaDesde)! } : {}),
        ...(vigencia.fechaHasta ? { fechaHasta: fechaISOConHora(vigencia.fechaHasta)! } : {}),
        extremosInclusivos: String(vigencia.extremosInclusivos),
      }).toString()}`
    : null;

  const { data: previewData, isLoading: previewLoading } = useFetchQuery<{ total: number; ultimoValor: number }>(
    // editando?.id en la key: crear y editar consultan totales distintos para
    // la misma vigencia, no pueden compartir entrada de caché. nivel también
    // entra en la key: el mismo entidadId puede colisionar numéricamente entre
    // niveles (ej. código de concepto "48" vs proveedorId 48).
    ["apertura-preview-total", nivel, entidadId, editando?.id ?? null, origen.localId, origen.puntoDeVentaId, vigencia.modo, vigencia.fechaDesde, vigencia.fechaHasta, vigencia.extremosInclusivos],
    previewUrl,
    { staleTime: 10_000 }
  );
  // null (no 0) mientras no se conocen — un 0 se leería como dato real tanto
  // en el agregado del header como en el $ de cada destino. `total` (suma de
  // todo el período) alimenta el header; `ultimoValor` (solo el mes más
  // reciente con compras) es la base del %↔$ de cada destino.
  const total = previewUrl !== null && !previewLoading ? previewData?.total ?? null : null;
  const ultimoValor = previewUrl !== null && !previewLoading ? previewData?.ultimoValor ?? null : null;

  // Reset de estado local al cerrarse el modal (entidadId -> null) —
  // ajuste durante el render en vez de useEffect (evita la cascada de
  // renders que dispara react-hooks/set-state-in-effect; mismo patrón que
  // React docs recomienda para "resetear estado cuando cambia una prop").
  const [prevEntidadId, setPrevEntidadId] = useState(entidadId);
  if (entidadId !== prevEntidadId) {
    setPrevEntidadId(entidadId);
    if (entidadId === null) {
      setView("lista");
      setEditando(null);
      setErrorGuardar(null);
    }
  }

  function abrirFormularioNuevo() {
    setEditando(null);
    setVigencia(nivel === "registro" ? VIGENCIA_REGISTRO : VIGENCIA_VACIA);
    setDestinos(destinosIniciales(origenLocalId, origenPdvId));
    setOrigen({ localId: origenLocalId, puntoDeVentaId: origenPdvId });
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
      // (una por combinación de nivel/modo/fechas), no solo la que está montada.
      queryClient.invalidateQueries({ queryKey: ["apertura-preview-total"] }),
      queryClient.invalidateQueries({ queryKey: ["pivot"] }),
      queryClient.invalidateQueries({ queryKey: ["detalle"] }),
    ]);
  }

  async function handleGuardar() {
    if (entidadId === null) return;
    setGuardando(true);
    setErrorGuardar(null);
    let guardadoOk = false;
    let comprasAfectadas: number | undefined;
    try {
      // Solo se mandan las fechas que el modo usa: una fecha vieja que quedó
      // en el formulario tras cambiar de modo el backend la ignora, pero se
      // persistiría igual en la regla si la mandáramos.
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
            body: JSON.stringify({ nivel, entidadId, ...cuerpoComun }),
          });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        if (res.status === 409) {
          setErrorGuardar(payload?.error ?? "Esta vigencia se superpone con otra regla activa de la misma entidad.");
        } else if (res.status === 422) {
          setErrorGuardar(payload?.issues?.[0]?.message ?? "Datos inválidos.");
        } else {
          setErrorGuardar("No se pudo guardar. Intentá de nuevo.");
        }
        return;
      }

      guardadoOk = true;
      const payload = await res.json().catch(() => null);
      comprasAfectadas = payload?.comprasAfectadas as number | undefined;
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
    if (comprasAfectadas === 0) {
      notify.aperturaSinCompras();
    } else {
      notify.registroActualizado();
    }
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
      notify.errorActualizar(entidadNombre);
    }
  }

  async function handleEliminar() {
    if (!reglaAEliminar) return;
    setEliminando(true);
    let erroresCascada: string[] | undefined;
    let eliminadoOk = false;
    try {
      const res = await fetch(`/api/apertura/reglas/${reglaAEliminar.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      eliminadoOk = true;
      const payload = await res.json().catch(() => null);
      erroresCascada = payload?.erroresCascada as string[] | undefined;
    } catch {
      notify.errorActualizar(entidadNombre);
    } finally {
      setEliminando(false);
    }

    // Se refresca siempre, también si el DELETE falló: un corte de red o un
    // timeout pueden dejar la regla ya borrada en el servidor, y sin esto la
    // lista seguiría mostrándola.
    //
    // Fuera del try de arriba a propósito (mismo criterio que handleGuardar):
    // el servidor YA eliminó. Si el refetch falla, lo peor es una pantalla
    // stale — no "no se pudo eliminar". Tampoco se espera al refetch antes de
    // avisar y cerrar: pivot/detalle son consultas pesadas y bloqueaban el
    // diálogo varios segundos.
    if (eliminadoOk) {
      setReglaAEliminar(null);
      if (erroresCascada && erroresCascada.length > 0) {
        notify.aperturaCascadaTrasEliminarConErrores(erroresCascada.length);
      } else {
        notify.registroActualizado();
      }
    }
    try {
      await refetchDependientes();
    } catch (err) {
      console.error("[apertura] no se pudieron refrescar los datos tras eliminar la regla", err);
    }
  }

  return (
    <>
      <Dialog open={entidadId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <Badge variant="secondary" className="w-fit">{NIVEL_LABELS[nivel]}</Badge>
            <DialogTitle className="text-base">Apertura de gastos — {entidadNombre}</DialogTitle>
          </DialogHeader>

          <Separator />

          {view === "lista" && (
            <div className="flex flex-col gap-2">
              {reglasLoading ? (
                <div className="py-8 flex justify-center"><Spinner size="lg" /></div>
              ) : reglasError ? (
                <div className="py-8 text-center text-sm text-destructive">
                  Error: {reglasError.message}
                </div>
              ) : reglasDeLaEntidad.length === 0 ? (
                <div className="py-8 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                  <Inbox className="w-8 h-8 opacity-40" />
                  <span>Todavía no hay reglas de apertura para esto.</span>
                  <span className="text-xs">Creá una para repartir este gasto entre otros locales o puntos de venta.</span>
                </div>
              ) : (
                <>
                {sinReglaVigente && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {AVISO_SIN_VIGENTE[nivel]}
                  </div>
                )}
                {reglasDeLaEntidad.map((regla) => {
                  const estadoVigencia = estadoVigenciaRegla(regla);
                  const badge = ESTADO_BADGE[estadoVigencia];
                  const atenuada = estadoVigencia === "vencida" || estadoVigencia === "inactiva";
                  return (
                  <div
                    key={regla.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
                      estadoVigencia === "vigente" && "border-emerald-300",
                      atenuada && "opacity-70"
                    )}
                  >
                    <div className="flex flex-1 flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant={badge.variant} className={badge.className}>
                          {ETIQUETA_ESTADO[estadoVigencia]}
                        </Badge>
                        <span className="text-xs text-foreground">{resumenVigencia(regla)}</span>
                      </div>
                      {renderDestinos(regla)}
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
                  );
                })}
                </>
              )}
              <button
                type="button"
                onClick={abrirFormularioNuevo}
                className={cn(
                  "mt-2 inline-flex items-center justify-center gap-1.5 h-8 rounded-md text-xs",
                  reglasDeLaEntidad.length === 0
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border hover:bg-muted"
                )}
              >
                <Plus className="h-3.5 w-3.5" /> Nueva regla
              </button>
            </div>
          )}

          {view === "formulario" && (
            <div className="flex flex-col gap-4">
              {editando && nivel !== "registro" ? (
                <AperturaOrigenSelector value={origen} locales={locales} onChange={setOrigen} />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Origen de la regla</span>
                  <p className="text-sm">{describirOrigen(locales, origen.localId, origen.puntoDeVentaId)}</p>
                </div>
              )}

              {nivel !== "registro" && (
                <AperturaVigenciaSelector value={vigencia} onChange={setVigencia} />
              )}

              {reactivaRegla && (
                <p className="text-xs text-muted-foreground">
                  Esta regla está inactiva: guardar la reactivará y volverá a distribuir las compras del período.
                </p>
              )}

              <Separator />

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Destinos</span>
                  <span className="flex items-center gap-1.5">
                    Total del período:{" "}
                    {previewLoading ? (
                      <Skeleton className="h-3.5 w-16" />
                    ) : total === null ? (
                      "—"
                    ) : (
                      fmtARS(total)
                    )}
                  </span>
                </div>
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-2">
                  {destinos.map((d, i) => (
                    <AperturaDestinoRow
                      key={i}
                      destino={d}
                      locales={locales}
                      total={ultimoValor}
                      otrosDestinos={destinos.filter((_, idx) => idx !== i)}
                      removable={destinos.length > 1}
                      onChange={(next) => setDestinos((prev) => prev.map((p, idx) => (idx === i ? next : p)))}
                      onRemove={() => setDestinos((prev) => prev.filter((_, idx) => idx !== i))}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setDestinos((prev) => [
                        ...prev,
                        // Si queda una sola combinación libre (ej. San Justo · Canchas), viene elegida.
                        autocompletarDestino({ ...destinoVacio(), porcentaje: restanteDePorcentaje(prev) }, locales, prev),
                      ])
                    }
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
