"use client";
import { useState, useMemo, useCallback } from "react";
import { notify } from "@/lib/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Building2, Truck, Tag, Layers, ArrowDownUp, FileText, MessageSquare } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn, fmtARS, fmtDate, normalize } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { buildComprasDetalleUrl } from "@/lib/dashboard/params";
import type { DetalleFilter, DetalleResponse, CompraDetalle } from "@/lib/dashboard/types";
import type { SortState } from "@/hooks/use-sort-state";
import {
  EditActionButtons, EditTriggerButton, EditedDot, toEditString,
} from "./edit-row-controls";
import { CompraLineasModal } from "./compra-lineas-modal";
import { DetalleModalShell } from "./detalle-modal-shell";

export interface ColDef {
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  right: boolean;
  sortKey?: string;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ConceptoOption = { codigo: string; nombre: string; rubroNombre: string };

type EditState = {
  rowId: string;
  importeManual: string;
  fechaManual: string;
  conceptoCodigoManual: string;
  observacManual: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isEdited(c: CompraDetalle) {
  return c.importeManual != null || c.fechaManual != null || c.conceptoCodigoManual != null || c.observacManual != null;
}

function toDateInputValue(iso: string | null | undefined): string {
  return iso?.slice(0, 10) ?? "";
}

// ─── ConceptoCombobox ─────────────────────────────────────────────────────────

function ConceptoCombobox({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: ConceptoOption[];
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
        <PopoverContent className="w-64 p-0">
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
  { label: "Concepto",    icon: Tag,            color: "text-cat-concepto",       bg: "bg-cat-concepto/12",      right: false, sortKey: "concepto"   },
  { label: "Rubro",       icon: Layers,         color: "text-cat-rubro",          bg: "bg-cat-rubro/12",         right: false                        },
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
  onEdit,
  onSave,
  onCancel,
  saving,
  onOpenLineas,
}: {
  item: CompraDetalle;
  editing: EditState | null;
  conceptoOptions: ConceptoOption[];
  onEdit: (state: EditState) => void;
  onSave: (state: EditState) => void;
  onCancel: () => void;
  saving: boolean;
  onOpenLineas: (rowId: string, detalle: string | null) => void;
}) {
  const isEditing = editing?.rowId === item.rowId;
  const effectiveFecha = item.fechaManual ?? item.fecha;
  const effectiveImporte = item.importeManual ?? item.importe;
  const effectiveConcepto = item.conceptoCajaManual ?? item.conceptoCaja;

  if (isEditing) {
    const selectedConcepto = conceptoOptions.find(c => c.codigo === editing!.conceptoCodigoManual);
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
        <td className="px-2 py-1.5">
          <ConceptoCombobox
            value={editing!.conceptoCodigoManual}
            onValueChange={v => onEdit({ ...editing!, conceptoCodigoManual: v })}
            options={conceptoOptions}
          />
        </td>
        <td className="px-3 py-1.5 truncate text-muted-foreground">
          {selectedConcepto?.rubroNombre ?? normalize(effectiveConcepto?.rubro?.nombre)}
        </td>
        <td className="px-2 py-1.5 text-right">
          <Input
            type="number"
            step="0.01"
            className="h-7 text-xs w-28 text-right"
            value={editing!.importeManual}
            onChange={e => onEdit({ ...editing!, importeManual: e.target.value })}
          />
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
        {item.detalle ? (
          <button
            onClick={() => onOpenLineas(item.rowId, item.detalle)}
            className="text-muted-foreground hover:text-foreground hover:underline font-mono text-xs whitespace-nowrap"
          >
            {item.detalle}
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-1.5 max-w-[12rem] whitespace-normal break-words text-muted-foreground">{normalize(item.observacManual ?? item.observac)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(effectiveConcepto?.nombre)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(effectiveConcepto?.rubro?.nombre)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums font-medium whitespace-nowrap">
        {fmtARS(effectiveImporte != null ? Number(effectiveImporte) : null)}
      </td>
      <td className="px-2 py-1.5">
        <EditTriggerButton
          onClick={() =>
            onEdit({
              rowId: String(item.rowId),
              importeManual: toEditString(item.importeManual ?? item.importe),
              fechaManual: toDateInputValue(item.fechaManual ?? item.fecha),
              conceptoCodigoManual: item.conceptoCodigoManual ?? item.conceptoCaja?.codigo ?? "",
              observacManual: item.observacManual ?? "",
            })
          }
        />
      </td>
    </tr>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function ComprasDetalleModal({ filter, onClose }: { filter: DetalleFilter | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedLineas, setSelectedLineas] = useState<{ rowId: string; detalle: string | null } | null>(null);

  // Retain last non-null filter so queryKey (and cached data) stay stable during close animation
  const [stableFilter, setStableFilter] = useState(filter);
  if (filter !== null && filter !== stableFilter) setStableFilter(filter);

  const queryKey = useMemo(() => ["detalle", stableFilter], [stableFilter]);

  const queryFn = useCallback(async (): Promise<DetalleResponse<CompraDetalle>> => {
    const res = await fetch(buildComprasDetalleUrl(filter!));
    if (!res.ok) throw new Error("Error cargando detalle");
    return res.json();
  }, [filter]);

  const { data: suggestions } = useQuery<Array<{ type: string; value: string; label: string; rubroNombre?: string }>>({
    queryKey: ["suggestions"],
    queryFn: () => fetch("/api/search/suggestions").then((r) => r.json()),
    staleTime: 5 * 60_000,
    enabled: filter !== null,
  });

  const conceptoOptions = useMemo<ConceptoOption[]>(
    () => (suggestions ?? [])
      .filter((s) => s.type === "concepto")
      .map((s) => ({ codigo: s.value, nombre: s.label, rubroNombre: s.rubroNombre ?? "" })),
    [suggestions]
  );

  const handleSave = useCallback(async (state: EditState) => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        importeManual:        state.importeManual !== "" ? parseFloat(state.importeManual) : null,
        fechaManual:          state.fechaManual !== "" ? new Date(state.fechaManual + "T12:00:00Z").toISOString() : null,
        conceptoCodigoManual: state.conceptoCodigoManual !== "" ? state.conceptoCodigoManual : null,
        observacManual:       state.observacManual !== "" ? state.observacManual : null,
      };
      const res = await fetch(`/api/dashboard/compras/${state.rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Error al guardar");
      await Promise.all([
        queryClient.refetchQueries({ queryKey }),
        queryClient.refetchQueries({ queryKey: ["pivot"] }),
      ]);
      setEditing(null);
      notify.registroActualizado();
    } catch {
      setSaveError("No se pudo guardar. Intentá de nuevo.");
      notify.errorGuardar();
    } finally {
      setSaving(false);
    }
  }, [queryClient, queryKey]);

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
        renderRow={(item) => (
          <ComprasRow
            key={item.rowId}
            item={item}
            editing={editing}
            conceptoOptions={conceptoOptions}
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
    </>
  );
}
