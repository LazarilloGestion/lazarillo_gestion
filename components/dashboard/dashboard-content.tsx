"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { DashboardTabContent } from "@/components/dashboard/dashboard-tab-content";
import { useFiltersPanel } from "@/hooks/use-dashboard-store";
export function DashboardContent() {
  // showFilters se seedea sincrónicamente desde localStorage en el store
  // (ver readPersistedField) — el primer render de cliente ya tiene el
  // valor real, sin fase intermedia. El override CSS en globals.css tapa
  // la ventana entre el HTML crudo del servidor y la hidratación.
  const { showFilters } = useFiltersPanel();
  const [clipping, setClipping] = useState(!showFilters);
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <div className="flex flex-col h-full p-4 md:p-6">
      <motion.div
        data-slot="dashboard-filters-panel"
        suppressHydrationWarning
        initial={false}
        animate={showFilters ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className={clipping ? "overflow-hidden" : undefined}
        onAnimationStart={() => setClipping(true)}
        onAnimationComplete={() => setClipping(!showFilters)}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white truncate">
            Panel de Gestión
          </h1>
          <p className="text-sm text-muted-foreground truncate">
            Resumen general de operaciones
          </p>
        </div>
        <div className="pt-6 pb-6">
          <DashboardFilters />
        </div>
      </motion.div>

      <div className="flex-1 min-h-0 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col">
        <DashboardTabContent isFullscreen={isFullscreen} onToggleFullscreen={() => setIsFullscreen(v => !v)} />
      </div>
    </div>
  );
}
