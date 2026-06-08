"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { DashboardTabContent } from "@/components/dashboard/dashboard-tab-content";
export function DashboardContent() {
  const [showFilters, setShowFilters] = useState(true);
  const [clipping, setClipping] = useState(false);

  return (
    <div className="flex flex-col h-full p-3 md:p-6 gap-4 md:gap-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white truncate">
            Panel de Gestión
          </h1>
        </div>
        <button
          onClick={() => { setClipping(true); setShowFilters(v => !v); }}
          title={showFilters ? "Ocultar filtros" : "Mostrar filtros"}
          className="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>

      <motion.div
        initial={false}
        animate={showFilters ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className={clipping ? "overflow-hidden pt-2" : "pt-2"}
        onAnimationComplete={() => setClipping(!showFilters)}
      >
        <DashboardFilters />
      </motion.div>

      <div className="flex-1 min-h-0 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col">
        <DashboardTabContent />
      </div>
    </div>
  );
}
