"use client";
import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Building2, Truck, Tag, Layers, ArrowDownUp, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmtARS, fmtDate, normalize } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { buildComprasDetalleUrl } from "@/lib/dashboard/params";
import type { DetalleFilter, DetalleResponse, CompraDetalle } from "@/lib/dashboard/types";
import {
  EditActionButtons, EditTriggerButton, EditedDot, toEditString,
} from "./edit-row-controls";

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
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isEdited(c: CompraDetalle) {
  return c.importeManual != null || c.fechaManual != null || c.conceptoCodigoManual != null;
}

function toDateInputValue(iso: string | null | undefined): string {
  return iso?.slice(0, 10) ?? "";
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COMPRAS_COLS: ColDef[] = [
  { label: "Fecha",     icon: CalendarDays, color: "text-muted-foreground", bg: "bg-muted",          right: false, sortKey: "fecha"     },
  { label: "Local",     icon: Building2,    color: "text-muted-foreground", bg: "bg-muted",          right: false                        },
  { label: "Proveedor", icon: Truck,        color: "text-emerald-500",      bg: "bg-emerald-500/10", right: false, sortKey: "proveedor"  },
  { label: "Concepto",  icon: Tag,          color: "text-violet-500",       bg: "bg-violet-500/10",  right: false, sortKey: "concepto"   },
  { label: "Rubro",     icon: Layers,       color: "text-blue-500",         bg: "bg-blue-500/10",    right: false                        },
  { label: "Importe",   icon: ArrowDownUp,  color: "text-muted-foreground", bg: "bg-muted",          right: true,  sortKey: "importe"    },
];

// ─── Row component ────────────────────────────────────────────────────────────

function ComprasRow({
  item,
  editing,
  conceptoOptions,
  onEdit,
  onSave,
  onCancel,
  saving,
}: {
  item: CompraDetalle;
  editing: EditState | null;
  conceptoOptions: ConceptoOption[];
  onEdit: (state: EditState) => void;
  onSave: (state: EditState) => void;
  onCancel: () => void;
  saving: boolean;
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
        <td className="px-4 py-1.5 text-sm truncate text-muted-foreground">
          {normalize(item.local?.nombre)}
        </td>
        <td className="px-4 py-1.5 text-sm truncate text-muted-foreground">
          {normalize(item.proveedor ?? item.proveedorRef?.nombre ?? item.proveedorRef?.razon)}
        </td>
        <td className="px-2 py-1.5">
          <Select
            value={editing!.conceptoCodigoManual}
            onValueChange={v => onEdit({ ...editing!, conceptoCodigoManual: v })}
          >
            <SelectTrigger className="h-7 text-xs w-44">
              <SelectValue placeholder="Sin cambio" />
            </SelectTrigger>
            <SelectContent>
              {conceptoOptions.map(opt => (
                <SelectItem key={opt.codigo} value={opt.codigo}>{opt.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
        {/* Rubro auto-populated from selected concept */}
        <td className="px-4 py-1.5 text-sm truncate text-muted-foreground">
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
      <td className="px-4 py-2.5 truncate">
        <span className="flex items-center gap-1.5">
          {isEdited(item) && <EditedDot />}
          {fmtDate(effectiveFecha)}
        </span>
      </td>
      <td className="px-4 py-2.5 truncate">{normalize(item.local?.nombre)}</td>
      <td className="px-4 py-2.5 truncate">
        {normalize(item.proveedor ?? item.proveedorRef?.nombre ?? item.proveedorRef?.razon)}
      </td>
      <td className="px-4 py-2.5 truncate">{normalize(effectiveConcepto?.nombre)}</td>
      <td className="px-4 py-2.5 truncate">{normalize(effectiveConcepto?.rubro?.nombre)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
        {fmtARS(effectiveImporte != null ? Number(effectiveImporte) : null)}
      </td>
      <td className="px-2 py-2.5">
        <EditTriggerButton
          onClick={() =>
            onEdit({
              rowId: String(item.rowId),
              importeManual: toEditString(item.importeManual ?? item.importe),
              fechaManual: toDateInputValue(item.fechaManual ?? item.fecha),
              conceptoCodigoManual: item.conceptoCodigoManual ?? item.conceptoCaja?.codigo ?? "",
            })
          }
        />
      </td>
    </tr>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function DetalleModal({ filter, onClose }: { filter: DetalleFilter | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["detalle", filter], [filter]);

  const { data: response, isLoading, error } = useQuery<DetalleResponse<CompraDetalle>>({
    queryKey,
    queryFn: async () => {
      if (!filter) throw new Error("Filter requerido");
      const res = await fetch(buildComprasDetalleUrl(filter));
      if (!res.ok) throw new Error("Error cargando detalle");
      return res.json() as Promise<DetalleResponse<CompraDetalle>>;
    },
    enabled: filter !== null,
    staleTime: 60_000,
    retry: 2,
    retryDelay: (i) => Math.min(1000 * 2 ** i, 30_000),
  });

  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  function handleSortClick(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

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
        fechaManual:          state.fechaManual !== "" ? new Date(state.fechaManual + "T00:00:00Z").toISOString() : null,
        conceptoCodigoManual: state.conceptoCodigoManual !== "" ? state.conceptoCodigoManual : null,
      };
      const res = await fetch(`/api/dashboard/compras/${state.rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Error al guardar");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["pivot"] }),
      ]);
      setEditing(null);
    } catch {
      setSaveError("No se pudo guardar. Intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }, [queryClient, queryKey]);

  const rawData = response?.data;
  const hasMore = response?.hasMore ?? false;
  const count = rawData?.length ?? 0;

  const data = useMemo(() => {
    if (!rawData || !sort) return rawData ?? [];
    return [...rawData].sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      if (sort.key === "importe") {
        va = Number(a.importeManual ?? a.importe ?? 0);
        vb = Number(b.importeManual ?? b.importe ?? 0);
        return sort.dir === "asc" ? (va - vb) : (vb - va);
      }
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
    });
  }, [rawData, sort]);

  return (
    <Dialog open={filter !== null} onOpenChange={(open) => { if (!open) { setEditing(null); onClose(); } }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-fit sm:min-w-[480px] max-w-[92vw] sm:max-w-[92vw] max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">

        {(!isLoading && !error && count > 0) ? null : (
          <div className="px-6 pt-4 pb-3 shrink-0">
            <DialogTitle className="text-base font-semibold">Detalle de compras</DialogTitle>
          </div>
        )}

        {isLoading && <div className="flex items-center justify-center py-12"><Spinner /></div>}
        {error && <div className="py-12 text-center text-sm text-destructive">Error al cargar los datos.</div>}
        {!isLoading && !error && count === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">Sin registros para la selección.</div>
        )}

        {!isLoading && !error && count > 0 && (
          <div className="overflow-auto flex-1 min-h-0">
            <table className="text-sm min-w-max w-full">
              <thead className="sticky top-0 z-10 bg-popover">
                <tr>
                  <th colSpan={COMPRAS_COLS.length + 1} className="px-6 pt-4 pb-3 text-left">
                    <DialogTitle className="text-base font-semibold">Detalle de compras</DialogTitle>
                  </th>
                </tr>
                <tr className="border-b border-border/60">
                  {COMPRAS_COLS.map(({ label, icon: Icon, color, bg, right, sortKey }) => (
                    <th
                      key={label}
                      className={`px-4 py-3 ${right ? "text-right" : "text-left"} ${sortKey ? "cursor-pointer select-none" : ""}`}
                      onClick={sortKey ? () => handleSortClick(sortKey) : undefined}
                    >
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider ${sort?.key === sortKey ? "text-foreground" : "text-muted-foreground"}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${bg}`}>
                          <Icon className={`h-3 w-3 ${color}`} />
                        </span>
                        {label}
                        {sortKey && (sort?.key === sortKey
                          ? sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          : <ChevronsUpDown className="h-3 w-3 opacity-40" />)}
                      </span>
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {data?.map((item) => (
                  <ComprasRow
                    key={item.rowId}
                    item={item}
                    editing={editing}
                    conceptoOptions={conceptoOptions}
                    onEdit={setEditing}
                    onSave={handleSave}
                    onCancel={() => setEditing(null)}
                    saving={saving}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {saveError && (
          <div className="border-t border-destructive/30 px-6 py-2 text-xs text-destructive">{saveError}</div>
        )}
        {(count > 0 || hasMore) && (
          <div className="border-t border-border/60 px-6 py-2.5 shrink-0 text-[11px] text-muted-foreground/60">
            {hasMore
              ? "Hay más de 500 registros — refiná los filtros para ver todos"
              : `${count} registro${count !== 1 ? "s" : ""}`}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
