"use client";
import { Package, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import type { AgrupacionCompras } from "@/lib/dashboard/params";

const BTN = "h-7 px-2.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1";
const ON = "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900";
const OFF = "text-muted-foreground hover:text-foreground";
const GRUPO = "inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5";

const VISTAS: { v: AgrupacionCompras; label: string; icon?: typeof Users; title?: string }[] = [
  { v: "concepto", label: "Concepto" },
  { v: "proveedor", label: "Proveedor", icon: Users },
  { v: "insumo", label: "Insumos", icon: Package, title: "Cada gasto por sus insumos (informe 25); sin detalle, por su concepto" },
];

// Vistas de la tabla de Compras en la barra de la tarjeta (rediseño, Diego 30/10/2026): antes iban
// en el encabezado de la 1ª columna y la estiraban.
export function VistaTablaToggles() {
  const { agrupacionCompras, setAgrupacionCompras, modoCelda, setModoCelda } = useDashboard();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="hidden sm:inline text-xs text-muted-foreground">ver por</span>
      <div className={GRUPO}>
        {VISTAS.map(({ v, label, icon: Icon, title }) => (
          <button key={v} onClick={() => setAgrupacionCompras(v)} aria-pressed={agrupacionCompras === v} title={title}
            className={cn(BTN, agrupacionCompras === v ? ON : OFF)}>
            {Icon && <Icon className="w-3 h-3" />}
            {label}
          </button>
        ))}
      </div>
      {/* $ / % ing: cada celda mensual como peso sobre los ingresos de ese mes. */}
      <div className={GRUPO}>
        <button onClick={() => setModoCelda("importe")} aria-pressed={modoCelda === "importe"} title="Celdas en pesos" className={cn(BTN, modoCelda === "importe" ? ON : OFF)}>$</button>
        <button onClick={() => setModoCelda("pct")} aria-pressed={modoCelda === "pct"} title="Celdas como % de los ingresos de cada mes" className={cn(BTN, modoCelda === "pct" ? ON : OFF)}>% ing</button>
      </div>
    </div>
  );
}
