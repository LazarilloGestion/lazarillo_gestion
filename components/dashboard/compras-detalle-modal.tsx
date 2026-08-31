"use client";
import { useState, useMemo, useCallback } from "react";
import { notify } from "@/lib/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Building2, Truck, Tag, Layers, ArrowDownUp, FileText, MessageSquare } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Command, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn, fmtARS, fmtDate, normalize } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { buildComprasDetalleUrl } from "@/lib/dashboard/params";
import { SIN_RUBRO_CODE, SIN_RUBRO_NOMBRE } from "@/lib/dashboard/constants";
import type { DetalleFilter, DetalleResponse, CompraDetalle } from "@/lib/dashboard/types";
import type { SortState } from "@/hooks/use-sort-state";
import {
  EditActionButtons, EditTriggerButton, EditedDot, toEditString,
} from "./edit-row-controls";
import { CompraLineasModal } from "./compra-lineas-modal";
import { DetalleModalShell } from "./detalle-modal-shell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";

export interface ColDef {
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  right: boolean;
  sortKey?: string;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ConceptoOption = { codigo: string; nombre: string; rubroNombre: string; rubroCodigo: string | null };

type RubroOption = { codigo: string; nombre: string };

type EditState = {
  rowId: string;
  // Una compra distribuida se abre en N filas de fan-out con el mismo rowId
  // (v_compras_distribuidas) — distribucionId desambigua cuál fila está en
  // edición para que el formulario no aparezca en las N a la vez.
  distribucionId: number | null;
  // La fila de fan-out solo trae su porción del importe (importeCalculado del
  // destino), no el importe de la compra base — con esto el guardado omite
  // importeManual para no pisar la compra base con una fracción, y el input de
  // importe queda bloqueado en edición.
  esDistribuida: boolean;
  importeManual: string;
  fechaManual: string;
  conceptoCodigoManual: string;
  observacManual: string;
  rubroFiltro: string; // solo filtra el combo de conceptos, nunca se guarda
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isEdited(c: CompraDetalle) {
  return c.importeManual != null || c.fechaManual != null || c.conceptoCodigoManual != null || c.observacManual != null;
}

function toDateInputValue(iso: string | null | undefined): string {
  return iso?.slice(0, 10) ?? "";
}

// ─── RubroSelect ──────────────────────────────────────────────────────────────

function RubroSelect({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: RubroOption[];
}) {
  return (
    <Select value={value || SIN_RUBRO_CODE} onValueChange={onValueChange}>
      <SelectTrigger className="h-7 w-36 text-xs" size="sm">
        <SelectValue placeholder="Rubro" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.codigo} value={o.codigo} className="text-xs">
            {o.nombre}
          </SelectItem>
        ))}
        <SelectItem value={SIN_RUBRO_CODE} className="text-xs text-muted-foreground">
          {SIN_RUBRO_NOMBRE}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

// ─── ConceptoCombobox ─────────────────────────────────────────────────────────

function ConceptoCombobox({
  value,
  onValueChange,
  options,
  portalContainer,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: ConceptoOption[];
  portalContainer: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.codigo === value);
  return (
    <div className="contents">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-44 items-center justify-between rounded-md border border-input bg-background px-2 text-xs hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <span className="truncate">{selected?.nombre ?? <span className="text-muted-foreground">Sin cambio</span>}</span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" container={portalContainer}>
          <Command>
            <CommandInput placeholder="Buscar concepto..." className="h-8 text-xs" />
            <CommandList className="max-h-52">
              <CommandEmpty className="py-2 text-center text-xs text-muted-foreground">Sin resultados.</CommandEmpty>
              {options.map((opt) => (
                <CommandItem
                  key={opt.codigo}
                  value={`${opt.codigo} ${opt.nombre}`}
                  onSelect={() => { onValueChange(opt.codigo); setOpen(false); }}
                  className="text-xs"
                >
                  <Check className={cn("mr-1 h-3 w-3", value === opt.codigo ? "opacity-100" : "opacity-0")} />
                  {opt.nombre}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COMPRAS_COLS: ColDef[] = [
  { label: "Fecha",       icon: CalendarDays,   color: "text-muted-foreground",   bg: "bg-muted",                right: false, sortKey: "fecha"     },
  { label: "Local",       icon: Building2,      color: "text-muted-foreground",   bg: "bg-muted",                right: false                        },
  { label: "Proveedor",   icon: Truck,          color: "text-cat-proveedor",      bg: "bg-cat-proveedor/12",     right: false, sortKey: "proveedor"  },
  { label: "Detalle",     icon: FileText,       color: "text-muted-foreground",   bg: "bg-muted",                right: false                        },
  { label: "Observación", icon: MessageSquare,  color: "text-cat-observacion",    bg: "bg-cat-observacion/12",   right: false                        },
  { label: "Rubro",       icon: Layers,         color: "text-cat-rubro",          bg: "bg-cat-rubro/12",         right: false                        },
  { label: "Concepto",    icon: Tag,            color: "text-cat-concepto",       bg: "bg-cat-concepto/12",      right: false, sortKey: "concepto"   },
  { label: "Importe",     icon: ArrowDownUp,    color: "text-muted-foreground",   bg: "bg-muted",                right: true,  sortKey: "importe"    },
];

// ─── Sort ─────────────────────────────────────────────────────────────────────

function sortCompras(a: CompraDetalle, b: CompraDetalle, sort: SortState): number {
  if (!sort) return 0;
  if (sort.key === "importe") {
    const va = Number(a.importeManual ?? a.importe ?? 0);
    const vb = Number(b.importeManual ?? b.importe ?? 0);
    return sort.dir === "asc" ? va - vb : vb - va;
  }
  let va = "", vb = "";
  if (sort.key === "fecha") {
    va = String(a.fechaManual ?? a.fecha ?? "").slice(0, 10);
    vb = String(b.fechaManual ?? b.fecha ?? "").slice(0, 10);
  } else if (sort.key === "proveedor") {
    va = String(a.proveedor || a.proveedorRef?.nombre || a.proveedorRef?.razon || "");
    vb = String(b.proveedor || b.proveedorRef?.nombre || b.proveedorRef?.razon || "");
  } else if (sort.key === "concepto") {
    va = String((a.conceptoCajaManual ?? a.conceptoCaja)?.nombre ?? "");
    vb = String((b.conceptoCajaManual ?? b.conceptoCaja)?.nombre ?? "");
  }
  const cmp = va.localeCompare(vb, "es", { numeric: true });
  return sort.dir === "asc" ? cmp : -cmp;
}

// ─── Row component ────────────────────────────────────────────────────────────

function ComprasRow({
  item,
  editing,
  conceptoOptions,
  rubroOptions,
  portalContainer,
  onEdit,
  onSave,
  onCancel,
  saving,
  onOpenLineas,
}: {
  item: CompraDetalle;
  editing: EditState | null;
  conceptoOptions: ConceptoOption[];
  rubroOptions: RubroOption[];
  portalContainer: HTMLElement | null;
  onEdit: (state: EditState) => void;
  onSave: (state: EditState) => void;
  onCancel: () => void;
  saving: boolean;
  onOpenLineas: (rowId: string, detalle: string | null) => void;
}) {
  const isEditing = editing?.rowId === item.rowId && editing.distribucionId === item.distribucionId;
  const effectiveFecha = item.fechaManual ?? item.fecha;
  const effectiveImporte = item.importeManual ?? item.importe;
  const effectiveConcepto = item.conceptoCajaManual ?? item.conceptoCaja;

  const rubroFiltro = editing?.rubroFiltro;
  const filteredConceptoOptions = useMemo(() => {
    if (!isEditing) return conceptoOptions;
    return rubroFiltro === SIN_RUBRO_CODE
      ? conceptoOptions.filter(o => !o.rubroCodigo)
      : conceptoOptions.filter(o => o.rubroCodigo === rubroFiltro);
  }, [conceptoOptions, isEditing, rubroFiltro]);

  if (isEditing) {
    return (
      <tr className="border-b border-border/40 last:border-0 bg-muted/20">
        <td className="px-2 py-1.5">
          <Input
            type="date"
            className="h-7 text-xs w-32"
            value={editing!.fechaManual}
            onChange={e => onEdit({ ...editing!, fechaManual: e.target.value })}
          />
        </td>
        <td className="px-3 py-1.5 truncate text-muted-foreground">
          {normalize(item.local?.nombre)}
        </td>
        <td className="px-3 py-1.5 truncate text-muted-foreground">
          {normalize(item.proveedor ?? item.proveedorRef?.nombre ?? item.proveedorRef?.razon)}
        </td>
        <td className="px-3 py-1.5 truncate text-muted-foreground">
          {normalize(item.detalle)}
        </td>
        <td className="px-2 py-1.5">
          <Input
            type="text"
            className="h-7 text-xs w-36"
            placeholder={normalize(item.observac) ?? ""}
            value={editing!.observacManual}
            onChange={e => onEdit({ ...editing!, observacManual: e.target.value })}
          />
        </td>
        <td className="px-3 py-1.5">
          <RubroSelect
            value={editing!.rubroFiltro}
            options={rubroOptions}
            onValueChange={(newRubro) => {
              const stillValid = conceptoOptions.some(
                o => o.codigo === editing!.conceptoCodigoManual &&
                  (newRubro === SIN_RUBRO_CODE ? !o.rubroCodigo : o.rubroCodigo === newRubro)
              );
              onEdit({
                ...editing!,
                rubroFiltro: newRubro,
                conceptoCodigoManual: stillValid ? editing!.conceptoCodigoManual : "",
              });
            }}
          />
        </td>
        <td className="px-2 py-1.5">
          <ConceptoCombobox
            value={editing!.conceptoCodigoManual}
            onValueChange={v => onEdit({ ...editing!, conceptoCodigoManual: v })}
            options={filteredConceptoOptions}
            portalContainer={portalContainer}
          />
        </td>
        <td className="px-2 py-1.5 text-right">
          {editing!.esDistribuida ? (
            // El importe de una compra distribuida se maneja desde la regla de
            // apertura (reparto por porcentaje), no editándolo acá — esta fila
            // solo conoce su fracción.
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <Input
                    type="number"
                    step="0.01"
                    disabled
                    className="h-7 text-xs w-28 text-right"
                    value={editing!.importeManual}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>El importe de una compra distribuida se ajusta desde la regla de apertura, no acá.</TooltipContent>
            </Tooltip>
          ) : (
            <Input
              type="number"
              step="0.01"
              className="h-7 text-xs w-28 text-right"
              value={editing!.importeManual}
              onChange={e => onEdit({ ...editing!, importeManual: e.target.value })}
            />
          )}
        </td>
        <td className="px-2 py-1.5">
          <EditActionButtons onSave={() => onSave(editing!)} onCancel={onCancel} saving={saving} />
        </td>
      </tr>
    );
  }

  return (
    <tr className="group border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
      <td className="px-3 py-1.5 truncate">
        <span className="flex items-center gap-1.5">
          {isEdited(item) && <EditedDot />}
          {fmtDate(effectiveFecha)}
        </span>
      </td>
      <td className="px-3 py-1.5 truncate">{normalize(item.local?.nombre)}</td>
      <td className="px-3 py-1.5 truncate">
        {normalize(item.proveedor ?? item.proveedorRef?.nombre ?? item.proveedorRef?.razon)}
      </td>
      <td className="px-3 py-1.5">
        {!item.detalle ? (
          <span className="text-muted-foreground">—</span>
        ) : item.distribucionId == null && !item.esDistribuido ? (
          <button
            onClick={() => onOpenLineas(item.rowId, item.detalle)}
            className="text-muted-foreground hover:text-foreground hover:underline font-mono text-xs whitespace-nowrap"
          >
            {item.detalle}
          </button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground font-mono text-xs whitespace-nowrap cursor-default">
                {item.detalle}
              </span>
            </TooltipTrigger>
            <TooltipContent>Compra distribuida — el detalle por líneas no está disponible acá todavía.</TooltipContent>
          </Tooltip>
        )}
      </td>
      <td className="px-3 py-1.5 max-w-[12rem] whitespace-normal break-words text-muted-foreground">{normalize(item.observacManual ?? item.observac)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(effectiveConcepto?.rubro?.nombre)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(effectiveConcepto?.nombre)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums font-medium whitespace-nowrap">
        {fmtARS(effectiveImporte != null ? Number(effectiveImporte) : null)}
      </td>
      <td className="px-2 py-1.5">
        {/* La edición ya está habilitada también para compras distribuidas: el
            PATCH apunta siempre a la compra base (item.rowId) y dispara la
            reevaluación de apertura. El importe queda bloqueado en el
            formulario (se reparte por regla), el resto de los campos sí se
            editan. "Ver líneas" sigue aparte y deshabilitado para distribuidas. */}
        <EditTriggerButton
          onClick={() => {
            const esDistribuida = item.esDistribuido || item.distribucionId != null;
            const initialConcepto = item.conceptoCodigoManual ?? item.conceptoCaja?.codigo ?? "";
            const initialRubro = conceptoOptions.find(o => o.codigo === initialConcepto)?.rubroCodigo ?? SIN_RUBRO_CODE;
            onEdit({
              rowId: String(item.rowId),
              distribucionId: item.distribucionId,
              esDistribuida,
              // En una fila de fan-out `item.importe` es solo la porción del
              // destino — no se prellena para no dar a entender que ese es el
              // importe editable de la compra base.
              importeManual: esDistribuida ? "" : toEditString(item.importeManual ?? item.importe),
              fechaManual: toDateInputValue(item.fechaManual ?? item.fecha),
              conceptoCodigoManual: initialConcepto,
              observacManual: item.observacManual ?? "",
              rubroFiltro: initialRubro,
            });
          }}
        />
      </td>
    </tr>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

// Distingue "el PATCH respondió con un error accionable" (ej. un 4xx del
// servidor con mensaje) de cualquier otro fallo (red, refetch) — solo el
// primero muestra su mensaje real al usuario, ver guardarConfirmado.
class GuardError extends Error {}

export function ComprasDetalleModal({ filter, onClose }: { filter: DetalleFilter | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { reglas: reglasApertura } = useReglasApertura();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedLineas, setSelectedLineas] = useState<{ rowId: string; detalle: string | null } | null>(null);
  // Guardado pendiente de confirmación del usuario: la edición dispara un
  // recálculo de apertura (compra distribuida o concepto nuevo con regla
  // activa) y se le pide OK antes de mandar el PATCH.
  const [pendienteConfirmacion, setPendienteConfirmacion] = useState<EditState | null>(null);

  // Retain last non-null filter so queryKey (and cached data) stay stable during close animation
  const [stableFilter, setStableFilter] = useState(filter);
  if (filter !== null && filter !== stableFilter) setStableFilter(filter);

  const queryKey = useMemo(() => ["detalle", stableFilter], [stableFilter]);

  const queryFn = useCallback(async (): Promise<DetalleResponse<CompraDetalle>> => {
    const res = await fetch(buildComprasDetalleUrl(stableFilter!));
    if (!res.ok) throw new Error("Error cargando detalle");
    return res.json();
  }, [stableFilter]);

  const { data: suggestions } = useQuery<Array<{ type: string; value: string; label: string; rubroNombre?: string; rubroCodigo?: string }>>({
    queryKey: ["suggestions"],
    queryFn: () => fetch("/api/search/suggestions").then((r) => r.json()),
    staleTime: 5 * 60_000,
    enabled: filter !== null,
  });

  const conceptoOptions = useMemo<ConceptoOption[]>(
    () => (suggestions ?? [])
      .filter((s) => s.type === "concepto")
      .map((s) => ({ codigo: s.value, nombre: s.label, rubroNombre: s.rubroNombre ?? "", rubroCodigo: s.rubroCodigo ?? null })),
    [suggestions]
  );

  const rubroOptions = useMemo<RubroOption[]>(
    () => (suggestions ?? [])
      .filter((s) => s.type === "rubro")
      .map((s) => ({ codigo: s.value, nombre: s.label })),
    [suggestions]
  );

  const guardarConfirmado = useCallback(async (state: EditState) => {
    setSaving(true);
    setSaveError(null);
    try {
      const requestBody = {
        // En una compra distribuida el importe se reparte por regla — no se
        // manda importeManual para no pisar la compra base con la fracción de
        // un destino (el input queda bloqueado en el formulario).
        ...(state.esDistribuida
          ? {}
          : { importeManual: state.importeManual !== "" ? parseFloat(state.importeManual) : null }),
        fechaManual:          state.fechaManual !== "" ? new Date(state.fechaManual + "T12:00:00Z").toISOString() : null,
        conceptoCodigoManual: state.conceptoCodigoManual !== "" ? state.conceptoCodigoManual : null,
        observacManual:       state.observacManual !== "" ? state.observacManual : null,
      };
      const res = await fetch(`/api/dashboard/compras/${state.rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const resBody = await res.json().catch(() => null);
        throw new GuardError(resBody?.error ?? "Error al guardar");
      }
    } catch (err) {
      // Solo un error del PATCH mismo (ej. el guard 409 de compra distribuida)
      // trae un mensaje accionable del servidor — un fallo de red antes de
      // llegar a la respuesta usa el texto genérico en vez del error técnico
      // crudo (revisión final de rama, ronda 2, hallazgo Minor).
      const message = err instanceof GuardError ? err.message : "No se pudo guardar. Intentá de nuevo.";
      setSaveError(message);
      notify.errorGuardar();
      setSaving(false);
      return;
    }

    // El PATCH ya guardó en este punto — un fallo del refetch posterior no es
    // "no se guardó" (los datos ya están persistidos del lado del servidor),
    // así que no lo tratamos como error de guardado.
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey }),
        queryClient.refetchQueries({ queryKey: ["pivot"] }),
        // La reevaluación de apertura puede haber creado/revertido
        // distribuciones — el badge de "regla activa" y la línea de tiempo
        // leen de ["apertura-reglas"].
        queryClient.invalidateQueries({ queryKey: ["apertura-reglas"] }),
      ]);
    } catch (err) {
      console.error("[compras-detalle-modal] guardado OK pero falló el refetch posterior", err);
    }
    setEditing(null);
    notify.registroActualizado();
    setSaving(false);
  }, [queryClient, queryKey]);

  // Decide si el guardado necesita confirmación: compra distribuida (se
  // recalcula el reparto) o concepto nuevo con una regla de apertura activa
  // (el guardado va a distribuir la compra).
  const handleSave = useCallback((state: EditState) => {
    const conceptoNuevo = state.conceptoCodigoManual;
    const requiereConfirmacion =
      state.esDistribuida ||
      (!!conceptoNuevo && reglasApertura.some((r) => r.estado === "activa" && r.entidadId === conceptoNuevo));
    if (requiereConfirmacion) {
      setPendienteConfirmacion(state);
    } else {
      void guardarConfirmado(state);
    }
  }, [reglasApertura, guardarConfirmado]);

  const searchFields = useCallback((item: CompraDetalle) => [
    item.proveedor,
    item.proveedorRef?.nombre,
    item.proveedorRef?.razon,
    item.observacManual,
    item.observac,
    item.detalle,
    item.concepto,
    (item.conceptoCajaManual ?? item.conceptoCaja)?.nombre,
    (item.conceptoCajaManual ?? item.conceptoCaja)?.rubro?.nombre,
    item.local?.nombre,
  ], []);

  const handleClose = useCallback(() => {
    setEditing(null);
    setSelectedLineas(null);
    onClose();
  }, [onClose]);

  return (
    <>
      <DetalleModalShell<CompraDetalle>
        open={filter !== null}
        onClose={handleClose}
        title="Detalle de compras"
        cols={COMPRAS_COLS}
        queryKey={queryKey}
        queryFn={queryFn}
        searchFields={searchFields}
        sortFn={sortCompras}
        saveError={saveError}
        isEditing={editing !== null}
        renderRow={(item, portalContainer) => (
          // distribucionId ?? rowId: una compra distribuida en N destinos
          // genera N objetos CompraDetalle con el mismo rowId (fan-out de
          // v_compras_distribuidas) — sin esto, React ve keys duplicadas.
          // Ahora que la edición también está habilitada para distribuidas,
          // isEditing compara rowId + distribucionId (ver ComprasRow) para que
          // el formulario aparezca solo en la fila que el usuario abrió, no en
          // las N que comparten rowId.
          <ComprasRow
            key={item.distribucionId != null ? `d-${item.distribucionId}` : item.rowId}
            item={item}
            editing={editing}
            conceptoOptions={conceptoOptions}
            rubroOptions={rubroOptions}
            portalContainer={portalContainer}
            onEdit={setEditing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
            saving={saving}
            onOpenLineas={(rowId, detalle) => setSelectedLineas({ rowId, detalle })}
          />
        )}
      />
      <CompraLineasModal
        compraId={selectedLineas?.rowId ?? null}
        comprobante={selectedLineas?.detalle ?? null}
        onClose={() => setSelectedLineas(null)}
      />
      <ConfirmDialog
        open={pendienteConfirmacion !== null}
        // Cancelar solo cierra el diálogo: la fila queda en edición y no se
        // manda ningún PATCH.
        onOpenChange={(open) => { if (!open) setPendienteConfirmacion(null); }}
        title="Recalcular apertura de gastos"
        description="Esto va a recalcular la apertura de este registro según las reglas de apertura vigentes. ¿Confirmás?"
        confirmLabel="Confirmar y guardar"
        confirming={saving}
        onConfirm={() => {
          const state = pendienteConfirmacion;
          setPendienteConfirmacion(null);
          if (state) void guardarConfirmado(state);
        }}
      />
    </>
  );
}
