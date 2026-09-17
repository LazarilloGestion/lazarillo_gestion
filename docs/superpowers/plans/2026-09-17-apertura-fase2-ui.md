# Apertura de Gastos Fase 2 — UI (Plan 2 de 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar la UI para crear reglas de apertura a nivel **proveedor** y **registro individual** — el motor y las rutas de API (Plan 1) ya lo soportan de punta a punta, verificado contra datos reales.

**Architecture:** `AperturaGastosModal` deja de ser exclusivo de concepto — se generaliza para aceptar `nivel`/`entidadId`/`entidadNombre` genéricos, con la sección de vigencia oculta y fijada a `historico` cuando `nivel === "registro"` (una regla de registro apunta a una sola compra, sin fechas). Los dos árboles del pivot (`PivotTableByConcepto`, `PivotTableByProveedor`) ganan un ícono "Aperturar" en los niveles que corresponden — proveedor solo existe en el árbol por proveedor (fila de nivel 0), registro individual en ambos árboles (fila de detalle, nivel más profundo), oculto por hover para no cargar visualmente filas que pueden ser cientos. Un solo estado unificado por archivo (`{nivel, entidadId, entidadNombre} | null`) reemplaza el estado exclusivo de concepto que hoy alimenta al modal.

**Tech Stack:** React 19, TypeScript estricto, TanStack Query, Tailwind CSS 4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-16-apertura-fase2-proveedor-registro-design.md` (sección 5, UI)

## Global Constraints

- Nivel `registro` nunca expone la sección de vigencia — internamente siempre `modo: "historico"`, `confirmarHistorico: true` (mismo criterio que el Plan 1 ya implementó server-side).
- El ícono de proveedor solo se muestra si `proveedor.proveedorId != null` (no existe "Sin Proveedor" como entidad aperturable) y con un local seleccionado (`localId != null`) — mismo gate que ya usa concepto.
- El ícono de registro individual usa `opacity-0 group-hover:opacity-100` (visible solo al pasar el mouse), salvo que ese registro puntual ya tenga una regla de registro activa — ahí queda visible siempre, coloreado. Requiere que el `<tr>` de esa fila tenga `className` con `"group"`.
- Ningún cambio al comportamiento existente de nivel `concepto` — es un refactor aditivo, no una reescritura de esa lógica.
- No agregar dependencias nuevas.
- Este repo no tiene tests de componentes React — verificación por `tsc`/`lint`/`build` + revisión manual del usuario en browser (Task 4), consistente con el resto del proyecto.

---

### Task 1: Generalizar `AperturaGastosModal` — `nivel`/`entidadId`/`entidadNombre`

**Files:**
- Modify: `components/dashboard/apertura-gastos-modal.tsx` (reemplazo completo del archivo)

**Interfaces:**
- Consumes: `NivelRegla` (exportado desde `lib/apertura/schemas.ts`, ya existe del Plan 1).
- Produces: `AperturaGastosModal` pasa a aceptar `{ nivel: NivelRegla; entidadId: string | null; entidadNombre: string; origenLocalId: number | null; origenPdvId: number | null; onClose: () => void }` — firma distinta a la actual (`conceptoCodigo`/`conceptoNombre`). Usado por Tasks 2 y 3.

- [ ] **Step 1: Reemplazar el archivo completo**

Reemplazar `components/dashboard/apertura-gastos-modal.tsx` por:

```tsx
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
import type { NivelRegla } from "@/lib/apertura/schemas";
import type { Local } from "@/lib/types/domain";
import { AperturaVigenciaSelector, type VigenciaFormState } from "./apertura-vigencia-selector";
import { AperturaDestinoRow, type DestinoFormState } from "./apertura-destino-row";
import { AperturaOrigenSelector, type OrigenFormState } from "./apertura-origen-selector";
import { describirOrigen } from "@/lib/apertura/descripcion-origen";

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

function resumenVigencia(regla: ReglaAperturaDTO): string {
  switch (regla.modo) {
    case "historico": return "Histórico completo";
    case "entre_fechas": return `${regla.fechaDesde?.slice(0, 10)} — ${regla.fechaHasta?.slice(0, 10)}`;
    case "desde_adelante": return `Desde ${regla.fechaDesde?.slice(0, 10)}`;
    case "desde_atras": return `Hasta ${regla.fechaHasta?.slice(0, 10)}`;
  }
}

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
    () => todasLasReglas.filter((r) => r.nivel === nivel && r.entidadId === entidadId).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)),
    [todasLasReglas, nivel, entidadId]
  );

  const { data: localesData } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const locales = localesData ?? [];

  // Nombres legibles para la línea de origen de cada card. Vive dentro del
  // componente porque depende de `locales` (lista remota).
  function resumenOrigen(regla: ReglaAperturaDTO): string {
    return `Origen: ${describirOrigen(locales, regla.origenLocalId, regla.origenPuntoDeVentaId)}`;
  }

  // El origen queda "completo" con solo el local elegido — el punto de venta es
  // opcional ("todo el local"). El backend (validarOrigen) exige al menos uno de
  // los dos, así que sin local no hay preview ni guardado posible.
  const origenCompleto = origen.localId != null;

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

  const { data: previewData, isLoading: previewLoading } = useFetchQuery<{ total: number }>(
    // editando?.id en la key: crear y editar consultan totales distintos para
    // la misma vigencia, no pueden compartir entrada de caché. nivel también
    // entra en la key: el mismo entidadId puede colisionar numéricamente entre
    // niveles (ej. código de concepto "48" vs proveedorId 48).
    ["apertura-preview-total", nivel, entidadId, editando?.id ?? null, origen.localId, origen.puntoDeVentaId, vigencia.modo, vigencia.fechaDesde, vigencia.fechaHasta, vigencia.extremosInclusivos],
    previewUrl,
    { staleTime: 10_000 }
  );
  // null (no 0) cuando el total todavía no se conoce — un 0 se leería como
  // dato real tanto en el agregado como en el $ de cada destino.
  const total = previewUrl !== null && !previewLoading ? previewData?.total ?? null : null;

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
      notify.errorActualizar(entidadNombre);
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
      notify.errorActualizar(entidadNombre);
    } finally {
      setEliminando(false);
    }
  }

  return (
    <>
      <Dialog open={entidadId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Apertura de gastos — {entidadNombre}</DialogTitle>
          </DialogHeader>

          {view === "lista" && (
            <div className="flex flex-col gap-2">
              {reglasLoading ? (
                <div className="py-8 flex justify-center"><Spinner size="lg" /></div>
              ) : reglasError ? (
                <div className="py-8 text-center text-sm text-destructive">
                  Error: {reglasError.message}
                </div>
              ) : reglasDeLaEntidad.length === 0 ? (
                <div className="py-4 flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <Inbox className="w-8 h-8 opacity-40" />
                  Todavía no hay reglas de apertura para esto.
                </div>
              ) : (
                reglasDeLaEntidad.map((regla) => (
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
              {editando ? (
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
                    onClick={() =>
                      setDestinos((prev) => [...prev, { ...destinoVacio(), porcentaje: restanteDePorcentaje(prev) }])
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
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: FALLA en este punto — `pivot-table-por-concepto.tsx` y `pivot-table-por-proveedor.tsx` todavía llaman a `<AperturaGastosModal conceptoCodigo=... conceptoNombre=... />` con la firma vieja. Esto es esperado: Tasks 2 y 3 actualizan esos call sites. No arreglar esos archivos en este task.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/apertura-gastos-modal.tsx
git commit -m "refactor(apertura): AperturaGastosModal acepta nivel/entidadId/entidadNombre genéricos

Deja de ser exclusivo de concepto. nivel=registro oculta la sección de
vigencia (siempre histórico, sin fechas — una regla de registro apunta
a una sola compra). Los call sites (pivot-table-por-*.tsx) se actualizan
en tareas siguientes de este mismo plan — tsc queda en rojo hasta que
las tres tareas landen juntas.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Íconos de proveedor y registro individual en `PivotTableByProveedor`

**Files:**
- Modify: `components/dashboard/pivot-table-por-proveedor.tsx`

**Interfaces:**
- Consumes: `AperturaGastosModal` con la firma nueva de Task 1.
- Produces: nada que otras tareas consuman — Task 3 es un archivo separado con su propio estado.

- [ ] **Step 1: Reemplazar el estado de apertura y el cálculo de reglas activas**

Reemplazar:

```tsx
  const [aperturaConcepto, setAperturaConcepto] = useState<{ codigo: string; nombre: string } | null>(null);
  const { reglas } = useReglasApertura();
  const conceptosConReglaActiva = useMemo(() => {
    const activas = reglas.filter((r) => r.estado === "activa" && r.nivel === "concepto");
    const alcanzaFiltro = (r: (typeof activas)[number]) => {
      if (pdvId == null && localId == null) return true;
      if (pdvId != null) {
        return origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          { localId: localId ?? r.origenLocalId, puntoDeVentaId: pdvId }
        );
      }
      return r.origenLocalId === localId;
    };
    return new Set(activas.filter(alcanzaFiltro).map((r) => r.entidadId));
  }, [reglas, localId, pdvId]);
```

por:

```tsx
  const [apertura, setApertura] = useState<{ nivel: NivelRegla; entidadId: string; entidadNombre: string } | null>(null);
  const { reglas } = useReglasApertura();
  // Un solo pase sobre las reglas activas alcanzables por el filtro actual,
  // separado por nivel — reemplaza conceptosConReglaActiva (Fase 1) ahora que
  // hay 3 niveles que pueden mostrar el ícono coloreado.
  const reglasActivasPorNivel = useMemo(() => {
    const activas = reglas.filter((r) => r.estado === "activa");
    const alcanzaFiltro = (r: (typeof activas)[number]) => {
      if (pdvId == null && localId == null) return true;
      if (pdvId != null) {
        return origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          { localId: localId ?? r.origenLocalId, puntoDeVentaId: pdvId }
        );
      }
      return r.origenLocalId === localId;
    };
    const alcanzadas = activas.filter(alcanzaFiltro);
    return {
      concepto: new Set(alcanzadas.filter((r) => r.nivel === "concepto").map((r) => r.entidadId)),
      proveedor: new Set(alcanzadas.filter((r) => r.nivel === "proveedor").map((r) => r.entidadId)),
      registro: new Set(alcanzadas.filter((r) => r.nivel === "registro").map((r) => r.entidadId)),
    };
  }, [reglas, localId, pdvId]);
```

Agregar el import de `NivelRegla` junto a los demás imports del archivo:

```tsx
import type { NivelRegla } from "@/lib/apertura/schemas";
```

- [ ] **Step 2: Ícono de proveedor en la fila nivel 0**

En la fila `item.type === "proveedorTop"`, reemplazar la celda del label:

```tsx
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <ExpandableButton isExpanded={isExpanded} onClick={() => toggleRow(proveedor.id)}>
                        {normalize(proveedor.nombre)}
                      </ExpandableButton>
                    </td>
```

por:

```tsx
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <div className="flex items-center gap-1">
                        <ExpandableButton isExpanded={isExpanded} onClick={() => toggleRow(proveedor.id)} className="flex-1 min-w-0">
                          {normalize(proveedor.nombre)}
                        </ExpandableButton>
                        {localId != null && proveedor.proveedorId != null && (
                          <button
                            type="button"
                            title="Apertura de gastos"
                            onClick={(e) => {
                              e.stopPropagation();
                              setApertura({
                                nivel: "proveedor",
                                entidadId: String(proveedor.proveedorId),
                                entidadNombre: normalize(proveedor.nombre),
                              });
                            }}
                            className={cn(
                              "shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors",
                              reglasActivasPorNivel.proveedor.has(String(proveedor.proveedorId))
                                ? "text-primary"
                                : "text-muted-foreground/40 hover:text-muted-foreground"
                            )}
                          >
                            <Split className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
```

- [ ] **Step 3: Actualizar el ícono existente de concepto para usar el estado unificado**

Reemplazar, dentro de `item.type === "conceptoSub"`:

```tsx
                        {localId != null && (
                          <button
                            type="button"
                            title="Apertura de gastos"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAperturaConcepto({ codigo: concepto.conceptoCodigo, nombre: concepto.nombre });
                            }}
                            className={cn(
                              "shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors",
                              conceptosConReglaActiva.has(concepto.conceptoCodigo)
                                ? "text-primary"
                                : "text-muted-foreground/40 hover:text-muted-foreground"
                            )}
                          >
                            <Split className="w-3 h-3" />
                          </button>
                        )}
```

por:

```tsx
                        {localId != null && (
                          <button
                            type="button"
                            title="Apertura de gastos"
                            onClick={(e) => {
                              e.stopPropagation();
                              setApertura({ nivel: "concepto", entidadId: concepto.conceptoCodigo, entidadNombre: concepto.nombre });
                            }}
                            className={cn(
                              "shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors",
                              reglasActivasPorNivel.concepto.has(concepto.conceptoCodigo)
                                ? "text-primary"
                                : "text-muted-foreground/40 hover:text-muted-foreground"
                            )}
                          >
                            <Split className="w-3 h-3" />
                          </button>
                        )}
```

- [ ] **Step 4: Ícono de registro individual en la fila de detalle (hover-reveal)**

Reemplazar el bloque completo de la fila de detalle (el `const linea = item.data;` hasta su `return`):

```tsx
              const linea = item.data;
              const labelParts = [
                linea.fecha ? `${linea.fecha.slice(8, 10)}/${linea.fecha.slice(5, 7)}` : null,
                linea.observac || null,
                fmtARS(linea.importe),
              ].filter(Boolean);
              return (
                <tr
                  key={linea.id}
                  className={cn(
                    "border-b transition-colors",
                    linea.hasManualOverride ? "bg-attention/5 hover:bg-attention/10" : "hover:bg-accent/20"
                  )}
                >
                  <td className={cn("sticky left-0 z-10 bg-background px-4 py-1.5 pl-14 text-xs shadow-[1px_0_0_0_hsl(var(--border))]", linea.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5">
                      {linea.hasManualOverride && <EditedDot />}
                      {labelParts.join(' · ')}
                    </span>
                  </td>
```

por:

```tsx
              const linea = item.data;
              const labelParts = [
                linea.fecha ? `${linea.fecha.slice(8, 10)}/${linea.fecha.slice(5, 7)}` : null,
                linea.observac || null,
                fmtARS(linea.importe),
              ].filter(Boolean);
              const labelLinea = labelParts.join(' · ');
              const tieneReglaRegistro = reglasActivasPorNivel.registro.has(linea.rowId);
              return (
                <tr
                  key={linea.id}
                  className={cn(
                    "group border-b transition-colors",
                    linea.hasManualOverride ? "bg-attention/5 hover:bg-attention/10" : "hover:bg-accent/20"
                  )}
                >
                  <td className={cn("sticky left-0 z-10 bg-background px-4 py-1.5 pl-14 text-xs shadow-[1px_0_0_0_hsl(var(--border))]", linea.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5">
                      {linea.hasManualOverride && <EditedDot />}
                      <span className="truncate">{labelLinea}</span>
                      {localId != null && (
                        <button
                          type="button"
                          title="Apertura de gastos"
                          onClick={(e) => {
                            e.stopPropagation();
                            setApertura({ nivel: "registro", entidadId: linea.rowId, entidadNombre: labelLinea });
                          }}
                          className={cn(
                            "shrink-0 flex h-4 w-4 items-center justify-center rounded hover:bg-muted transition-opacity",
                            tieneReglaRegistro
                              ? "text-primary opacity-100"
                              : "text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                          )}
                        >
                          <Split className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </span>
                  </td>
```

(el resto de la fila — celdas de meses, total, % — no cambia, dejarlo tal cual está.)

- [ ] **Step 5: Actualizar el render de `AperturaGastosModal`**

Reemplazar:

```tsx
      <AperturaGastosModal
        conceptoCodigo={aperturaConcepto?.codigo ?? null}
        conceptoNombre={aperturaConcepto?.nombre ?? ""}
        origenLocalId={localId ?? null}
        origenPdvId={pdvId ?? null}
        onClose={() => setAperturaConcepto(null)}
      />
```

por:

```tsx
      <AperturaGastosModal
        nivel={apertura?.nivel ?? "concepto"}
        entidadId={apertura?.entidadId ?? null}
        entidadNombre={apertura?.entidadNombre ?? ""}
        origenLocalId={localId ?? null}
        origenPdvId={pdvId ?? null}
        onClose={() => setApertura(null)}
      />
```

- [ ] **Step 6: Verificar tipos, lint y tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: `tsc` sigue en rojo si Task 3 todavía no landó (este archivo ya compila bien solo, pero el archivo hermano `pivot-table-por-concepto.tsx` sigue con la firma vieja) — confirmar que los únicos errores de `tsc` a esta altura son en `pivot-table-por-concepto.tsx`, no en este archivo.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/pivot-table-por-proveedor.tsx
git commit -m "feat(dashboard): ícono Aperturar en proveedor y registro individual (vista por proveedor)

Estado unificado {nivel, entidadId, entidadNombre} reemplaza el estado
exclusivo de concepto. El ícono de registro queda oculto por hover
(group-hover) para no cargar visualmente filas de detalle, que pueden
ser cientos — visible sin hover solo si ese registro puntual ya tiene
una regla propia activa.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Ícono de registro individual en `PivotTableByConcepto`

**Files:**
- Modify: `components/dashboard/pivot-table-por-concepto.tsx`

**Interfaces:**
- Consumes: `AperturaGastosModal` con la firma nueva de Task 1.

- [ ] **Step 1: Reemplazar el estado de apertura y el cálculo de reglas activas**

Reemplazar:

```tsx
  const [aperturaConcepto, setAperturaConcepto] = useState<{ codigo: string; nombre: string } | null>(null);
  const { reglas } = useReglasApertura();
  // Step 2: indicador sensible al filtro local/PDV.
  // Considera solo reglas cuyo origen cae dentro del filtro seleccionado.
  const conceptosConReglaActiva = useMemo(() => {
    const activas = reglas.filter((r) => r.estado === "activa" && r.nivel === "concepto");
    const alcanzaFiltro = (r: (typeof activas)[number]) => {
      if (pdvId == null && localId == null) return true;
      if (pdvId != null) {
        return origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          { localId: localId ?? r.origenLocalId, puntoDeVentaId: pdvId }
        );
      }
      return r.origenLocalId === localId; // solo local seleccionado
    };
    return new Set(activas.filter(alcanzaFiltro).map((r) => r.entidadId));
  }, [reglas, localId, pdvId]);
```

por:

```tsx
  const [apertura, setApertura] = useState<{ nivel: NivelRegla; entidadId: string; entidadNombre: string } | null>(null);
  const { reglas } = useReglasApertura();
  // Un solo pase sobre las reglas activas alcanzables por el filtro actual,
  // separado por nivel — este árbol solo necesita concepto y registro (no
  // proveedor: acá no hay una fila de proveedor donde mostrar ese ícono, ver
  // PivotTableByProveedor para el nivel proveedor).
  const reglasActivasPorNivel = useMemo(() => {
    const activas = reglas.filter((r) => r.estado === "activa");
    const alcanzaFiltro = (r: (typeof activas)[number]) => {
      if (pdvId == null && localId == null) return true;
      if (pdvId != null) {
        return origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          { localId: localId ?? r.origenLocalId, puntoDeVentaId: pdvId }
        );
      }
      return r.origenLocalId === localId;
    };
    const alcanzadas = activas.filter(alcanzaFiltro);
    return {
      concepto: new Set(alcanzadas.filter((r) => r.nivel === "concepto").map((r) => r.entidadId)),
      registro: new Set(alcanzadas.filter((r) => r.nivel === "registro").map((r) => r.entidadId)),
    };
  }, [reglas, localId, pdvId]);
```

Agregar el import de `NivelRegla` junto a los demás imports del archivo:

```tsx
import type { NivelRegla } from "@/lib/apertura/schemas";
```

- [ ] **Step 2: Actualizar el ícono existente de concepto para usar el estado unificado**

Reemplazar, dentro del bloque de la fila de concepto:

```tsx
                        {localId != null && (
                          <button
                            type="button"
                            title="Apertura de gastos"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAperturaConcepto({ codigo: concepto.conceptoCodigo, nombre: concepto.nombre });
                            }}
                            className={cn(
                              "shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors",
                              conceptosConReglaActiva.has(concepto.conceptoCodigo)
                                ? "text-primary"
                                : "text-muted-foreground/40 hover:text-muted-foreground"
                            )}
                          >
                            <Split className="w-3 h-3" />
                          </button>
                        )}
```

por:

```tsx
                        {localId != null && (
                          <button
                            type="button"
                            title="Apertura de gastos"
                            onClick={(e) => {
                              e.stopPropagation();
                              setApertura({ nivel: "concepto", entidadId: concepto.conceptoCodigo, entidadNombre: concepto.nombre });
                            }}
                            className={cn(
                              "shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors",
                              reglasActivasPorNivel.concepto.has(concepto.conceptoCodigo)
                                ? "text-primary"
                                : "text-muted-foreground/40 hover:text-muted-foreground"
                            )}
                          >
                            <Split className="w-3 h-3" />
                          </button>
                        )}
```

- [ ] **Step 3: Ícono de registro individual en la fila de detalle (hover-reveal)**

Reemplazar el bloque completo de la fila de detalle (desde `const prov = item.data;` hasta el `<td>` del label):

```tsx
              const prov = item.data;
              const labelParts = [
                prov.fecha ? `${prov.fecha.slice(8, 10)}/${prov.fecha.slice(5, 7)}` : null,
                normalize(prov.nombre),
                prov.observac || null,
                fmtARS(prov.importe),
              ].filter(Boolean);
              return (
                <tr
                  key={prov.id}
                  className={cn(
                    "border-b transition-colors",
                    prov.hasManualOverride
                      ? "bg-attention/5 hover:bg-attention/10"
                      : "hover:bg-accent/20"
                  )}
                >
                  <td className={cn("sticky left-0 z-10 bg-background px-4 py-1.5 pl-14 text-xs shadow-[1px_0_0_0_hsl(var(--border))]", prov.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5">
                      {prov.hasManualOverride && <EditedDot />}
                      {labelParts.join(' · ')}
                    </span>
                  </td>
```

por:

```tsx
              const prov = item.data;
              const labelParts = [
                prov.fecha ? `${prov.fecha.slice(8, 10)}/${prov.fecha.slice(5, 7)}` : null,
                normalize(prov.nombre),
                prov.observac || null,
                fmtARS(prov.importe),
              ].filter(Boolean);
              const labelProv = labelParts.join(' · ');
              const tieneReglaRegistro = reglasActivasPorNivel.registro.has(prov.rowId);
              return (
                <tr
                  key={prov.id}
                  className={cn(
                    "group border-b transition-colors",
                    prov.hasManualOverride
                      ? "bg-attention/5 hover:bg-attention/10"
                      : "hover:bg-accent/20"
                  )}
                >
                  <td className={cn("sticky left-0 z-10 bg-background px-4 py-1.5 pl-14 text-xs shadow-[1px_0_0_0_hsl(var(--border))]", prov.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5">
                      {prov.hasManualOverride && <EditedDot />}
                      <span className="truncate">{labelProv}</span>
                      {localId != null && (
                        <button
                          type="button"
                          title="Apertura de gastos"
                          onClick={(e) => {
                            e.stopPropagation();
                            setApertura({ nivel: "registro", entidadId: prov.rowId, entidadNombre: labelProv });
                          }}
                          className={cn(
                            "shrink-0 flex h-4 w-4 items-center justify-center rounded hover:bg-muted transition-opacity",
                            tieneReglaRegistro
                              ? "text-primary opacity-100"
                              : "text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                          )}
                        >
                          <Split className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </span>
                  </td>
```

(el resto de la fila no cambia.)

- [ ] **Step 4: Actualizar el render de `AperturaGastosModal`**

Reemplazar:

```tsx
      <AperturaGastosModal
        conceptoCodigo={aperturaConcepto?.codigo ?? null}
        conceptoNombre={aperturaConcepto?.nombre ?? ""}
        origenLocalId={localId ?? null}
        origenPdvId={pdvId ?? null}
        onClose={() => setAperturaConcepto(null)}
      />
```

por:

```tsx
      <AperturaGastosModal
        nivel={apertura?.nivel ?? "concepto"}
        entidadId={apertura?.entidadId ?? null}
        entidadNombre={apertura?.entidadNombre ?? ""}
        origenLocalId={localId ?? null}
        origenPdvId={pdvId ?? null}
        onClose={() => setApertura(null)}
      />
```

- [ ] **Step 5: Verificar tipos, lint, tests y build**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: todo en verde — esta es la última de las 3 tareas que tocan la firma del modal, `tsc` debe quedar limpio de punta a punta.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/pivot-table-por-concepto.tsx
git commit -m "feat(dashboard): ícono Aperturar de registro individual (vista por concepto)

Mismo patrón que la vista por proveedor (Task 2) — estado unificado,
ícono de registro oculto por hover salvo que ya tenga regla propia
activa. Este árbol no tiene fila de proveedor, así que solo suma
concepto (ya existía) y registro (nuevo).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Verificación manual en browser (a cargo del usuario)

**Files:** ninguno — solo verificación. Sin acceso a browser en este entorno.

- [ ] **Paso 1**: Con un local seleccionado, abrir "Aperturar" desde una fila de **proveedor** (vista por proveedor, nivel 0) — el modal debe abrir mostrando la sección de vigencia normal (igual que concepto hoy), crear una regla de prueba y confirmar que funciona igual que crear una de concepto.
- [ ] **Paso 2**: Abrir "Aperturar" desde una fila de **detalle/registro individual** (cualquiera de los dos árboles) — el ícono debe estar oculto hasta pasar el mouse por esa fila puntual. Confirmar que el modal abre **sin** la sección de vigencia, y que "Crear regla" funciona sin pedir confirmar histórico (ya viene fijo).
- [ ] **Paso 3**: Crear una regla de registro sobre una compra, recargar la página → el ícono de esa fila debe quedar visible sin necesidad de hover (coloreado, indicando que ya tiene regla activa).
- [ ] **Paso 4**: Confirmar que el flujo de concepto (crear/editar/desactivar/eliminar) sigue funcionando exactamente igual que antes de este plan — no debería haber ningún cambio visible ahí.
- [ ] **Paso 5**: Con muchas filas de detalle visibles (scroll largo), confirmar que el ícono oculto por hover no genera saltos de layout ni lentitud perceptible.
