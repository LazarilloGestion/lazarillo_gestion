"use client";

import { cn } from "@/lib/utils";
import { dias, tramoAntiguedad } from "@/lib/impagas/clasificar";

const TRAMO_CLS = {
  reciente: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  media: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  vieja: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
} as const;

export function Antiguedad({ fecha, hoy }: { fecha: string; hoy: Date }) {
  const d = dias(fecha, hoy);
  return (
    <span className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums", TRAMO_CLS[tramoAntiguedad(d)])}>
      {d} d
    </span>
  );
}

export function Boton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="h-7 px-2.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 disabled:opacity-40 whitespace-nowrap"
    >
      {children}
    </button>
  );
}

