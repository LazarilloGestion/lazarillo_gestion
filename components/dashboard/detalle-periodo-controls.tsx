"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { labelPeriodo, navegar, cambiarModo, type Periodo, type ModoPeriodo } from "@/lib/dashboard/detalle-periodo";

// ‹ Julio 2026 › + toggle Mes / Año / Histórico, en el encabezado del modal
// Detalle de compras (mockup del punto 2 de Pendientes_desarrollo_etapa3).
// En Histórico las flechas se ocultan: no hay a dónde navegar.
export function DetallePeriodoControls({ periodo, onChange }: { periodo: Periodo; onChange: (p: Periodo) => void }) {
  const modos: { id: ModoPeriodo; label: string }[] = [
    { id: "mes", label: "Mes" },
    { id: "anio", label: "Año" },
    { id: "historico", label: "Histórico" },
  ];
  const navegable = periodo.modo !== "historico";
  return (
    <div className="flex items-center gap-2 text-sm font-normal">
      <div className="flex items-center gap-1">
        {navegable && (
          <button
            type="button"
            aria-label={periodo.modo === "mes" ? "Mes anterior" : "Año anterior"}
            onClick={() => onChange(navegar(periodo, -1))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <span className="min-w-[7.5rem] rounded-md border border-border px-3 py-1 text-center font-semibold tabular-nums">
          {labelPeriodo(periodo)}
        </span>
        {navegable && (
          <button
            type="button"
            aria-label={periodo.modo === "mes" ? "Mes siguiente" : "Año siguiente"}
            onClick={() => onChange(navegar(periodo, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5">
        {modos.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={periodo.modo === m.id}
            onClick={() => onChange(cambiarModo(periodo, m.id))}
            className={cn(
              "h-7 px-2.5 rounded-md text-xs font-medium transition-all",
              periodo.modo === m.id
                ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
