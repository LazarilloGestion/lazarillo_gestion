"use client";

import { useDashboard } from "@/hooks/use-dashboard-store";
import { cn } from "@/lib/utils";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

const MONTH_LABELS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function summarize(selected: Set<number>): string {
  if (selected.size === 0 || selected.size === 12) return "Todos los meses";
  if (selected.size === 1) {
    const [m] = selected;
    return MONTH_LABELS[m - 1];
  }
  const sorted = [...selected].sort((a, b) => a - b);
  const isRange =
    sorted.length === sorted[sorted.length - 1] - sorted[0] + 1;
  if (isRange) return `${MONTH_LABELS[sorted[0] - 1]} – ${MONTH_LABELS[sorted[sorted.length - 1] - 1]}`;
  return `${selected.size} meses`;
}

export function MonthFilterDrawer() {
  const { selectedMonths, toggleMonth, clearMonths } = useDashboard();

  const hasFilter = selectedMonths.size > 0 && selectedMonths.size < 12;

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button
          className={cn(
            "h-8 flex items-center gap-2 px-3 rounded-lg border text-sm transition-all shrink-0",
            hasFilter
              ? "bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white text-white dark:text-zinc-900 font-medium"
              : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
          )}
        >
          <span>{summarize(selectedMonths)}</span>
          {hasFilter && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 dark:bg-zinc-900/20 text-[10px] font-bold">
              {selectedMonths.size}
            </span>
          )}
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <div className="flex items-center justify-between">
            <DrawerTitle>Filtrar por mes</DrawerTitle>
            {hasFilter && (
              <button
                onClick={clearMonths}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Limpiar
              </button>
            )}
          </div>
        </DrawerHeader>

        <div className="grid grid-cols-3 gap-2 p-4 pt-2 pb-8">
          {MONTH_LABELS.map((label, i) => {
            const idx = i + 1;
            const active = selectedMonths.has(idx);
            return (
              <button
                key={idx}
                onClick={() => toggleMonth(idx)}
                aria-pressed={active}
                className={cn(
                  "h-12 rounded-xl text-sm font-medium transition-all border",
                  active
                    ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white"
                    : "bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
