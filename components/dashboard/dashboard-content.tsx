"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { DashboardTabContent } from "@/components/dashboard/dashboard-tab-content";
import { useFiltersPanel } from "@/hooks/use-dashboard-store";
export function DashboardContent({ defaultOpen }: { defaultOpen: boolean }) {
  // showFilters vive en el store; el botón del header lo togglea (solo /dashboard).
  // defaultOpen viene del server (cookie) y es la fuente del primer paint, sin flash.
  const { showFilters, setShowFilters } = useFiltersPanel();
  const [seeded, setSeeded] = useState(false);
  const [clipping, setClipping] = useState(!defaultOpen);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sembrar el store con la preferencia del server una vez en cliente.
  useEffect(() => {
    setShowFilters(defaultOpen);
    setSeeded(true);
  }, [defaultOpen, setShowFilters]);

  // Hasta sembrar, usar defaultOpen para que SSR y primer render del cliente coincidan.
  const open = seeded ? showFilters : defaultOpen;

  return (
    <div className="flex flex-col h-full p-4 md:p-6">
      <motion.div
        initial={false}
        animate={open ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className={clipping ? "overflow-hidden" : undefined}
        onAnimationStart={() => setClipping(true)}
        onAnimationComplete={() => setClipping(!open)}
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
