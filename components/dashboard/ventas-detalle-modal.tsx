"use client";
import { useState, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, Building2, Tag, Layers, ArrowDownUp, Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { fmtARS, fmtDate, normalize } from "@/lib/utils";
import { buildVentasDetalleUrl } from "@/lib/dashboard/params";
import type { VentasDetalleFilter, VentaDetalle, DetalleResponse } from "@/lib/dashboard/types";
import type { SortState } from "@/hooks/use-sort-state";
import type { ColDef } from "./compras-detalle-modal";
import { EditActionButtons, EditTriggerButton, EditedDot, toEditString } from "./edit-row-controls";
import { DetalleModalShell } from "./detalle-modal-shell";

const VENTAS_COLS: ColDef[] = [
  { label: "Fecha",       icon: CalendarDays, color: "text-muted-foreground", bg: "bg-muted",          right: false, sortKey: "fecha"   },
  { label: "Local",       icon: Building2,    color: "text-muted-foreground", bg: "bg-muted",          right: false                      },
  { label: "Tipo",        icon: Layers,       color: "text-blue-500",         bg: "bg-blue-500/10",    right: false, sortKey: "tipo"    },
  { label: "Cobro",       icon: Tag,          color: "text-violet-500",       bg: "bg-violet-500/10",  right: false, sortKey: "cobro"   },
  { label: "Turno",       icon: Users,        color: "text-muted-foreground", bg: "bg-muted",          right: false, sortKey: "turno"   },
  { label: "Comprobante", icon: Tag,          color: "text-muted-foreground", bg: "bg-muted",          right: false                      },
  { label: "Mesa",        icon: Tag,          color: "text-muted-foreground", bg: "bg-muted",          right: false                      },
  { label: "Mozo",        icon: Users,        color: "text-muted-foreground", bg: "bg-muted",          right: false                      },
  { label: "Importe",     icon: ArrowDownUp,  color: "text-muted-foreground", bg: "bg-muted",          right: true,  sortKey: "importe" },
];

type EditState = { rowId: string; importeManual: string };

function sortVentas(a: VentaDetalle, b: VentaDetalle, sort: SortState): number {
  if (!sort) return 0;
  if (sort.key === "importe") {
    const va = Number(a.importeManual ?? a.importe ?? 0);
    const vb = Number(b.importeManual ?? b.importe ?? 0);
    return sort.dir === "asc" ? va - vb : vb - va;
  }
  const va = String(a[sort.key as keyof VentaDetalle] ?? "");
  const vb = String(b[sort.key as keyof VentaDetalle] ?? "");
  const cmp = va.localeCompare(vb, "es", { numeric: true });
  return sort.dir === "asc" ? cmp : -cmp;
}

function VentasRow({
  item,
  editing,
  onEdit,
  onSave,
  onCancel,
  saving,
}: {
  item: VentaDetalle;
  editing: EditState | null;
  onEdit: (s: EditState) => void;
  onSave: (s: EditState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const isEditing = editing?.rowId === item.rowId;
  const effectiveImporte = item.importeManual ?? item.importe;

  if (isEditing) {
    const readOnly = [
      fmtDate(item.fecha),
      normalize(item.local?.nombre),
      normalize(item.tipo),
      normalize(item.cobro),
      normalize(item.turno),
      normalize(item.comprobant),
      normalize(item.mesa),
      normalize(item.mozo),
    ];
    return (
      <tr className="border-b border-border/40 last:border-0 bg-muted/20">
        {readOnly.map((v, i) => (
          <td key={i} className="px-3 py-1.5 truncate text-muted-foreground">{v}</td>
        ))}
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
      <td className="px-3 py-1.5 truncate">{fmtDate(item.fecha)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(item.local?.nombre)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(item.tipo)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(item.cobro)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(item.turno)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(item.comprobant)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(item.mesa)}</td>
      <td className="px-3 py-1.5 truncate">{normalize(item.mozo)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums font-medium whitespace-nowrap">
        <span className="flex items-center justify-end gap-1.5">
          {item.importeManual != null && <EditedDot />}
          {fmtARS(effectiveImporte != null ? Number(effectiveImporte) : null)}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <EditTriggerButton
          onClick={() =>
            onEdit({
              rowId: String(item.rowId),
              importeManual: toEditString(item.importeManual ?? item.importe),
            })
          }
        />
      </td>
    </tr>
  );
}

export function VentasDetalleModal({ filter, onClose }: { filter: VentasDetalleFilter | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Retain last non-null filter so queryKey (and cached data) stay stable during close animation
  const [stableFilter, setStableFilter] = useState(filter);
  if (filter !== null && filter !== stableFilter) setStableFilter(filter);

  const queryKey = useMemo(() => ["detalle-ventas", stableFilter], [stableFilter]);

  const queryFn = useCallback(async (): Promise<DetalleResponse<VentaDetalle>> => {
    const res = await fetch(buildVentasDetalleUrl(filter!));
    if (!res.ok) throw new Error("Error cargando detalle");
    return res.json();
  }, [filter]);

  const handleSave = useCallback(async (state: EditState) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/dashboard/ventas/${state.rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importeManual: state.importeManual !== "" ? parseFloat(state.importeManual) : null,
        }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      await Promise.all([
        queryClient.refetchQueries({ queryKey }),
        queryClient.refetchQueries({ queryKey: ["pivot-ventas"] }),
      ]);
      setEditing(null);
    } catch {
      setSaveError("No se pudo guardar. Intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }, [queryClient, queryKey]);

  const searchFields = useCallback((item: VentaDetalle) => [
    item.tipo,
    item.cobro,
    item.turno,
    item.comprobant,
    item.mesa,
    item.mozo,
    item.local?.nombre,
  ], []);

  const handleClose = useCallback(() => {
    setEditing(null);
    onClose();
  }, [onClose]);

  return (
    <DetalleModalShell<VentaDetalle>
      open={filter !== null}
      onClose={handleClose}
      title="Detalle de ventas"
      cols={VENTAS_COLS}
      queryKey={queryKey}
      queryFn={queryFn}
      searchFields={searchFields}
      sortFn={sortVentas}
      saveError={saveError}
      renderRow={(item) => (
        <VentasRow
          key={item.rowId}
          item={item}
          editing={editing}
          onEdit={setEditing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      )}
    />
  );
}
