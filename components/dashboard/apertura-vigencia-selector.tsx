"use client";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export type ModoVigencia = "historico" | "entre_fechas" | "desde_adelante" | "desde_atras";

export interface VigenciaFormState {
  modo: ModoVigencia;
  fechaDesde: string; // yyyy-mm-dd (value de <input type="date">), "" si no aplica
  fechaHasta: string;
  extremosInclusivos: boolean;
  confirmarHistorico: boolean;
}

const MODO_LABELS: Record<ModoVigencia, string> = {
  historico: "Todos los registros (histórico completo)",
  entre_fechas: "Entre dos fechas",
  desde_adelante: "Desde una fecha en adelante",
  desde_atras: "Desde una fecha hacia atrás",
};

const MODOS: ModoVigencia[] = ["historico", "entre_fechas", "desde_adelante", "desde_atras"];

export function AperturaVigenciaSelector({
  value,
  onChange,
}: {
  value: VigenciaFormState;
  onChange: (next: VigenciaFormState) => void;
}) {
  const [modoAbierto, setModoAbierto] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      {modoAbierto && (
        <div className="absolute inset-0 z-40 rounded-xl bg-black/10" />
      )}
      <Select
        open={modoAbierto}
        onOpenChange={setModoAbierto}
        value={value.modo}
        onValueChange={(v) => onChange({ ...value, modo: v as ModoVigencia })}
      >
        <SelectTrigger className="relative z-50 h-8 w-full text-xs" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODOS.map((modo) => (
            <SelectItem key={modo} value={modo} className="text-xs">
              {MODO_LABELS[modo]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(value.modo === "entre_fechas" || value.modo === "desde_adelante") && (
        <label className="flex items-center gap-2 text-xs">
          Desde
          <Input
            type="date"
            className="h-8 w-40 text-xs"
            value={value.fechaDesde}
            onChange={(e) => onChange({ ...value, fechaDesde: e.target.value })}
          />
        </label>
      )}

      {(value.modo === "entre_fechas" || value.modo === "desde_atras") && (
        <label className="flex items-center gap-2 text-xs">
          Hasta
          <Input
            type="date"
            className="h-8 w-40 text-xs"
            value={value.fechaHasta}
            onChange={(e) => onChange({ ...value, fechaHasta: e.target.value })}
          />
        </label>
      )}

      {value.modo !== "historico" && (
        <label className="flex items-center gap-2 text-xs">
          <Switch
            size="sm"
            checked={value.extremosInclusivos}
            onCheckedChange={(checked) => onChange({ ...value, extremosInclusivos: checked })}
          />
          Extremos inclusivos (incluye el día exacto de la fecha límite)
        </label>
      )}

      {value.modo === "historico" && (
        <label className="flex items-center gap-2 text-xs text-attention">
          <Switch
            size="sm"
            checked={value.confirmarHistorico}
            onCheckedChange={(checked) => onChange({ ...value, confirmarHistorico: checked })}
          />
          Confirmo aplicar a todo el histórico de este concepto
        </label>
      )}
    </div>
  );
}
