"use client";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, Building2, Tag, Layers, ArrowDownUp, Users,
} from "lucide-react";
import { useTableSearch } from "@/hooks/use-table-search";
import { SearchInput } from "@/components/ui/search-input";
import { useSortState } from "@/hooks/use-sort-state";
import { SortableTableHead } from "./sortable-table-head";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { fmtARS, fmtDate, normalize } from "@/lib/utils";
import { buildVentasDetalleUrl } from "@/lib/dashboard/params";
import type { VentasDetalleFilter, VentaDetalle, DetalleResponse } from "@/lib/dashboard/types";
import type { ColDef } from "./detalle-modal";
import { EditActionButtons, EditTriggerButton, EditedDot, toEditString } from "./edit-row-controls";

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
          <td key={i} className="px-4 py-2.5 truncate text-muted-foreground">{v}</td>
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
      <td className="px-4 py-2.5 truncate">{fmtDate(item.fecha)}</td>
      <td className="px-4 py-2.5 truncate">{normalize(item.local?.nombre)}</td>
      <td className="px-4 py-2.5 truncate">{normalize(item.tipo)}</td>
      <td className="px-4 py-2.5 truncate">{normalize(item.cobro)}</td>
      <td className="px-4 py-2.5 truncate">{normalize(item.turno)}</td>
      <td className="px-4 py-2.5 truncate">{normalize(item.comprobant)}</td>
      <td className="px-4 py-2.5 truncate">{normalize(item.mesa)}</td>
      <td className="px-4 py-2.5 truncate">{normalize(item.mozo)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
        <span className="flex items-center justify-end gap-1.5">
          {item.importeManual != null && <EditedDot />}
          {fmtARS(effectiveImporte != null ? Number(effectiveImporte) : null)}
        </span>
      </td>
      <td className="px-2 py-2.5">
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
  const { sort, handleSortClick } = useSortState();

  const queryKey = useMemo(() => ["detalle-ventas", filter], [filter]);

  const { data: response, isLoading, error } = useQuery<DetalleResponse<VentaDetalle>>({
    queryKey,
    queryFn: async () => {
      if (!filter) throw new Error("Filter requerido");
      const res = await fetch(buildVentasDetalleUrl(filter));
      if (!res.ok) throw new Error("Error cargando detalle");
      return res.json() as Promise<DetalleResponse<VentaDetalle>>;
    },
    enabled: filter !== null,
    staleTime: 60_000,
    retry: 2,
    retryDelay: (i) => Math.min(1000 * 2 ** i, 30_000),
  });

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
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["pivot-ventas"] }),
      ]);
      setEditing(null);
    } catch {
      setSaveError("No se pudo guardar. Intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }, [queryClient, queryKey]);

  const rawData = response?.data;
  const count = rawData?.length ?? 0;

  const data = useMemo(() => {
    if (!rawData || !sort) return rawData ?? [];
    return [...rawData].sort((a, b) => {
      if (sort.key === "importe") {
        const va = Number(a.importeManual ?? a.importe ?? 0);
        const vb = Number(b.importeManual ?? b.importe ?? 0);
        return sort.dir === "asc" ? va - vb : vb - va;
      }
      const va = String(a[sort.key as keyof VentaDetalle] ?? "");
      const vb = String(b[sort.key as keyof VentaDetalle] ?? "");
      const cmp = va.localeCompare(vb, "es", { numeric: true });
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rawData, sort]);

  const { query, setQuery, filtered } = useTableSearch(data, (item) => [
    item.tipo,
    item.cobro,
    item.turno,
    item.comprobant,
    item.mesa,
    item.mozo,
    item.local?.nombre,
  ]);

  useEffect(() => { setQuery(""); }, [filter, setQuery]);

  return (
    <Dialog open={filter !== null} onOpenChange={(open) => { if (!open) { setEditing(null); onClose(); } }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-fit sm:min-w-[480px] max-w-[92vw] sm:max-w-[92vw] max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">

        {(!isLoading && !error && count > 0) ? null : (
          <div className="px-6 pt-4 pb-3 shrink-0">
            <DialogTitle className="text-base font-semibold">Detalle de ventas</DialogTitle>
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
                  <th colSpan={VENTAS_COLS.length + 1} className="px-6 pt-4 pb-3 text-left">
                    <div className="flex items-center justify-between gap-4">
                      <DialogTitle className="text-base font-semibold">Detalle de ventas</DialogTitle>
                      <SearchInput value={query} onChange={setQuery} className="w-44" />
                    </div>
                  </th>
                </tr>
                <tr className="border-b border-border/60">
                  <SortableTableHead cols={VENTAS_COLS} sort={sort} onSort={handleSortClick} />
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <VentasRow
                    key={item.rowId}
                    item={item}
                    editing={editing}
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
        {count > 0 && (
          <div className="border-t border-border/60 px-6 py-2.5 shrink-0 text-[11px] text-muted-foreground/60">
            {query
              ? `${filtered.length} de ${count} registro${count !== 1 ? "s" : ""}`
              : `${count} registro${count !== 1 ? "s" : ""}`}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
