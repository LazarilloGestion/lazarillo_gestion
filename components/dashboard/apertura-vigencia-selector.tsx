"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

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
  desde_atras: "Hasta una fecha (hacia atrás)",
};

const MODOS: ModoVigencia[] = ["historico", "entre_fechas", "desde_adelante", "desde_atras"];

export function AperturaVigenciaSelector({
  value,
  onChange,
}: {
  value: VigenciaFormState;
  onChange: (next: VigenciaFormState) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Select value={value.modo} onValueChange={(v) => onChange({ ...value, modo: v as ModoVigencia })}>
        <SelectTrigger className="h-8 w-full text-xs" size="sm">
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
          <input
            type="checkbox"
            checked={value.extremosInclusivos}
            onChange={(e) => onChange({ ...value, extremosInclusivos: e.target.checked })}
          />
          Extremos inclusivos (incluye el día exacto de la fecha límite)
        </label>
      )}

      {value.modo === "historico" && (
        <label className="flex items-center gap-2 text-xs text-attention">
          <input
            type="checkbox"
            checked={value.confirmarHistorico}
            onChange={(e) => onChange({ ...value, confirmarHistorico: e.target.checked })}
          />
          Confirmo aplicar a todo el histórico de este concepto
        </label>
      )}
    </div>
  );
}
