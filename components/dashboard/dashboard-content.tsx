"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { DashboardTabContent } from "@/components/dashboard/dashboard-tab-content";
import { useFiltersPanel } from "@/hooks/use-dashboard-store";
import { ActualizadoAl } from "@/components/dashboard/actualizado-al";
import { SwitchEcoFin } from "@/components/dashboard/switch-eco-fin";
import { CargarFactura } from "@/components/facturas/cargar-factura";
export function DashboardContent() {
  // showFilters se seedea sincrónicamente desde localStorage en el store
  // (ver readPersistedField) — el primer render de cliente ya tiene el
  // valor real, sin fase intermedia. El override CSS en globals.css tapa
  // la ventana entre el HTML crudo del servidor y la hidratación.
  const { showFilters } = useFiltersPanel();
  const [clipping, setClipping] = useState(!showFilters);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // El atributo data-filters-open solo debe existir durante la ventana
  // pre-hidratación (lo pone el bootstrap script para el override CSS de
  // abajo). Si queda después de montar, gana por especificidad sobre el
  // overflow-hidden que maneja `clipping` y el panel nunca puede reabrirse
  // visualmente tras cerrarse.
  useEffect(() => {
    document.documentElement.removeAttribute("data-filters-open");
  }, []);

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
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white truncate">
              Panel de Gestión
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="truncate">Resumen general de operaciones</span>
              <ActualizadoAl />
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 md:flex-row md:items-start md:gap-3">
            {/* Carga de facturas (Etapa 4, punto 1). */}
            <CargarFactura />
            {/* Switch Económica / Financiera (punto 4 de Etapa 3): arriba, a la altura del título. */}
            <SwitchEcoFin />
          </div>
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
