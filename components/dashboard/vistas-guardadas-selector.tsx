"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { notify } from "@/lib/toast";
import { Bookmark, ChevronDown, Check, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import type { RubroVisibilidad } from "@/lib/dashboard/types";
import { MONTH_IDXS } from "@/lib/dashboard/constants";

interface VistaGuardada {
  id: number;
  nombre: string;
  param: "rubroCodigo" | "conceptoCodigo" | "proveedorId" | "observacionQuery" | null;
  value: string | null;
  label: string | null;
  conceptosVisibles: string[];
  meses: number[];
}

type DialogState = { mode: "create" } | { mode: "rename"; vista: VistaGuardada } | null;

const VISTAS_KEY = ["resultados-vistas"];

export function VistasGuardadasSelector() {
  const {
    activeSearchParam: activeParam, activeSearchValue: activeValue, searchLabel,
    setSearch, clearSearch, months, setSelectedMonths, clearMonths,
    bumpResultadosConfig, setResultadosOcultoCount,
  } = useDashboard();
  const queryClient = useQueryClient();
  const { data: vistas, isLoading } = useFetchQuery<VistaGuardada[]>(VISTAS_KEY, "/api/dashboard/resultados-vistas");

  const [dialog, setDialog] = useState<DialogState>(null);
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VistaGuardada | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Id de la última vista aplicada/sobrescrita explícitamente por el usuario — necesario
  // porque dos vistas "config-only" (sin filtro ⌘K) tienen ambas param/value en null y son
  // indistinguibles comparando sólo filtro+meses; con esto se sabe cuál fue la que se tocó.
  // "default" = la entrada fija sin selección (no es una fila real de la DB).
  const [appliedVistaId, setAppliedVistaId] = useState<number | "default" | null>(null);

  function mesesIguales(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((m, i) => m === b[i]);
  }

  // Las filas de vista/Default son <div> (no <button>) para poder anidar los botones de
  // acción sin los problemas de foco de un <button> dentro de otro — esto las repone
  // como alcanzables por teclado (Tab + Enter/Espacio) igual que un elemento nativo.
  function onRowKeyDown(fn: () => void) {
    return (e: React.KeyboardEvent) => {
      // Ignora el keydown si burbujeó desde un botón anidado (lápiz/tacho/⟳) — si no,
      // Enter con foco en esos botones dispararía también applyVista/applyDefault.
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fn();
      }
    };
  }

  // La vista aplicada sigue marcada mientras el filtro/meses actuales todavía coincidan
  // con lo que esa vista capturó — se desmarca sola en cuanto el usuario los cambia a mano.
  const appliedVista = typeof appliedVistaId === "number" ? vistas?.find((v) => v.id === appliedVistaId) : undefined;
  const activeVista =
    appliedVista &&
    (appliedVista.param ?? undefined) === activeParam &&
    (appliedVista.value ?? undefined) === activeValue &&
    mesesIguales(appliedVista.meses, months)
      ? appliedVista
      : undefined;

  const isDefaultActive =
    appliedVistaId === "default" && !activeParam && mesesIguales(months, MONTH_IDXS);

  // Lee los conceptos visibles actuales cuando no hay filtro de búsqueda activo (esa es
  // la "vista" en ese caso), y valida que no quede todo vacío. null = cancelar el guardado.
  async function readConceptosVisiblesIfNeeded(): Promise<string[] | null> {
    let conceptosVisibles: string[] = [];
    if (!activeParam) {
      const res = await fetch("/api/config/rubros-dashboard?field=visibleEnResultados");
      if (!res.ok) throw new Error("Error al leer conceptos visibles");
      const rubros: RubroVisibilidad[] = await res.json();
      conceptosVisibles = rubros.filter((r) => r.visible).map((r) => r.codigo);
    }
    if (!activeParam && conceptosVisibles.length === 0) {
      notify.errorSinFiltro();
      return null;
    }
    return conceptosVisibles;
  }

  // PUT del set de conceptos visibles + refresco de contador/versión. Devuelve si tuvo
  // éxito para que el llamador sólo marque la vista como "aplicada" cuando esto confirmó.
  async function setVisibleConceptos(codigos: string[]): Promise<boolean> {
    try {
      const res = await fetch("/api/config/rubros-dashboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "visibleEnResultados", codigosVisibles: codigos }),
      });
      if (!res.ok) throw new Error("Error al aplicar conceptos visibles");
      const { ocultos } = await res.json();
      setResultadosOcultoCount(ocultos);
      bumpResultadosConfig();
      return true;
    } catch {
      notify.errorGuardar();
      return false;
    }
  }

  async function applyVista(vista: VistaGuardada) {
    if (vista.param && vista.value) setSearch(vista.param, vista.value, vista.label ?? vista.value);
    setSelectedMonths(vista.meses);
    if (vista.conceptosVisibles.length > 0) {
      const ok = await setVisibleConceptos(vista.conceptosVisibles);
      if (!ok) return; // no marcar como aplicada si la visibilidad no llegó a cambiar
    }
    setAppliedVistaId(vista.id);
  }

  async function applyDefault() {
    clearSearch();
    clearMonths();
    const ok = await setVisibleConceptos([]);
    if (!ok) return;
    setAppliedVistaId("default");
  }

  function openCreate() {
    // El DropdownMenu se cierra en el mismo tick del click; abrir el Dialog de
    // inmediato pisa el foco/pointer-events de Radix y el diálogo no se ve.
    // Se difiere al próximo tick, ya con el dropdown cerrado.
    setTimeout(() => {
      setNombre("");
      setDialog({ mode: "create" });
    }, 0);
  }

  function openRename(vista: VistaGuardada) {
    setTimeout(() => {
      setNombre(vista.nombre);
      setDialog({ mode: "rename", vista });
    }, 0);
  }

  async function handleSubmit() {
    if (!dialog || !nombre.trim()) return;
    setSaving(true);
    try {
      if (dialog.mode === "create") {
        // Si hay filtro de búsqueda activo, la vista es ese filtro. Si no, "lo que se
        // ve" es la config de conceptos visibles actual — se captura sola, sin preguntar.
        const conceptosVisibles = await readConceptosVisiblesIfNeeded();
        if (conceptosVisibles === null) return;
        const res = await fetch("/api/dashboard/resultados-vistas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: nombre.trim(),
            ...(activeParam && activeValue
              ? { param: activeParam, value: activeValue, label: searchLabel || activeValue }
              : {}),
            conceptosVisibles,
            meses: months,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error("[VistasGuardadasSelector] POST falló", res.status, body);
          throw new Error("Error al guardar");
        }
        const created: VistaGuardada = await res.json();
        setAppliedVistaId(created.id);
      } else {
        const res = await fetch(`/api/dashboard/resultados-vistas/${dialog.vista.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: nombre.trim() }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error("[VistasGuardadasSelector] PATCH falló", res.status, body);
          throw new Error("Error al renombrar");
        }
      }
      await queryClient.invalidateQueries({ queryKey: VISTAS_KEY });
      notify.registroActualizado();
      setDialog(null);
    } catch {
      notify.errorGuardar();
    } finally {
      setSaving(false);
    }
  }

  async function handleOverwrite(vista: VistaGuardada) {
    try {
      const conceptosVisibles = await readConceptosVisiblesIfNeeded();
      if (conceptosVisibles === null) return;
      const res = await fetch(`/api/dashboard/resultados-vistas/${vista.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          param: activeParam ?? null,
          value: activeValue ?? null,
          label: activeParam ? (searchLabel || activeValue) : null,
          conceptosVisibles,
          meses: months,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("[VistasGuardadasSelector] overwrite falló", res.status, body);
        throw new Error("Error al sobrescribir");
      }
      await queryClient.invalidateQueries({ queryKey: VISTAS_KEY });
      setAppliedVistaId(vista.id);
      notify.registroActualizado();
    } catch {
      notify.errorGuardar();
    }
  }

  function openDelete(vista: VistaGuardada) {
    // Mismo motivo que openCreate/openRename: diferir para no chocar con el cierre
    // del DropdownMenu en el mismo tick.
    setTimeout(() => setDeleteTarget(vista), 0);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/dashboard/resultados-vistas/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al borrar");
      await queryClient.invalidateQueries({ queryKey: VISTAS_KEY });
      setDeleteTarget(null);
    } catch {
      notify.errorGuardar();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="h-8 w-auto px-3 flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all"
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span className="text-sm font-normal max-w-[140px] truncate">
              {isDefaultActive ? "Default" : activeVista?.nombre ?? "Vistas"}
            </span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div
            role="button"
            tabIndex={0}
            onClick={applyDefault}
            onKeyDown={onRowKeyDown(applyDefault)}
            className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isDefaultActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            <span>Default</span>
          </div>
          <DropdownMenuSeparator />
          {isLoading ? (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">Cargando…</div>
          ) : !vistas || vistas.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">No hay vistas guardadas</div>
          ) : (
            vistas.map((vista) => (
              <div
                key={vista.id}
                role="button"
                tabIndex={0}
                onClick={() => applyVista(vista)}
                onKeyDown={onRowKeyDown(() => applyVista(vista))}
                className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1.5 truncate">
                  {vista.id === activeVista?.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  <span className="truncate">{vista.nombre}</span>
                </span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOverwrite(vista); }}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Sobrescribir con el estado actual"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openRename(vista); }}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Renombrar vista"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openDelete(vista); }}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Eliminar vista"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Guardar vista actual
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {dialog?.mode === "rename" ? "Renombrar vista" : "Guardar vista actual"}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre de la vista"
            maxLength={60}
            onKeyDown={(e) => { if (e.key === "Enter" && nombre.trim()) handleSubmit(); }}
          />
          <DialogFooter>
            <button
              onClick={() => setDialog(null)}
              className="h-8 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!nombre.trim() || saving}
              className="h-8 px-3 rounded-lg text-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Guardar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Borrar "${deleteTarget?.nombre}"?`}
        description="Esta acción no se puede deshacer."
        confirmLabel="Borrar"
        destructive
        confirming={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
