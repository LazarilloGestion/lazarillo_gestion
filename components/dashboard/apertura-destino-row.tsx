"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { montoDesdePct, pctDesdeMonto } from "@/lib/apertura/conversion";
import type { Local } from "@/lib/types/domain";

export interface DestinoFormState {
  localId: number | null;
  puntoDeVentaId: number | null;
  porcentaje: number;
}

const TODO_EL_LOCAL = "__todo_el_local";

export function AperturaDestinoRow({
  destino,
  locales,
  total,
  onChange,
  onRemove,
  removable,
}: {
  destino: DestinoFormState;
  locales: Local[];
  total: number;
  onChange: (next: DestinoFormState) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const localSeleccionado = locales.find((l) => l.id === destino.localId);
  const puntosDeVenta = localSeleccionado?.puntosDeVenta ?? [];
  const monto = montoDesdePct(destino.porcentaje, total);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={destino.localId != null ? String(destino.localId) : ""}
        onValueChange={(v) => onChange({ ...destino, localId: Number(v), puntoDeVentaId: null })}
      >
        <SelectTrigger className="h-8 w-32 text-xs" size="sm">
          <SelectValue placeholder="Local" />
        </SelectTrigger>
        <SelectContent>
          {locales.map((l) => (
            <SelectItem key={l.id} value={String(l.id)} className="text-xs">
              {l.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={destino.puntoDeVentaId != null ? String(destino.puntoDeVentaId) : TODO_EL_LOCAL}
        onValueChange={(v) => onChange({ ...destino, puntoDeVentaId: v === TODO_EL_LOCAL ? null : Number(v) })}
        disabled={!localSeleccionado}
      >
        <SelectTrigger className="h-8 w-32 text-xs" size="sm">
          <SelectValue placeholder="Punto de venta" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODO_EL_LOCAL} className="text-xs">Todo el local</SelectItem>
          {puntosDeVenta.map((p) => (
            <SelectItem key={p.id} value={String(p.id)} className="text-xs">
              {p.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.01"
          min={0}
          max={100}
          className="h-8 w-16 text-xs text-right"
          value={destino.porcentaje}
          onChange={(e) => onChange({ ...destino, porcentaje: Number(e.target.value) || 0 })}
        />
        <span className="text-xs text-muted-foreground">%</span>
      </div>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.01"
          className="h-8 w-24 text-xs text-right"
          value={monto}
          onChange={(e) => onChange({ ...destino, porcentaje: pctDesdeMonto(Number(e.target.value) || 0, total) })}
        />
        <span className="text-xs text-muted-foreground">$</span>
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
