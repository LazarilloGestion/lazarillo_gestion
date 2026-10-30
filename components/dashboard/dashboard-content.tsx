"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { DashboardTabContent } from "@/components/dashboard/dashboard-tab-content";
import { useFiltersPanel } from "@/hooks/use-dashboard-store";
import { ActualizadoAl } from "@/components/dashboard/actualizado-al";
import { SwitchEcoFin } from "@/components/dashboard/switch-eco-fin";
import { KpiTarjetas } from "@/components/dashboard/kpi-tarjetas";
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
    // En el celular (Diego 28/10: "se hace imposible verlo, ni me scrollea"): la página scrollea
    // normal y la tabla ocupa una pantalla entera debajo de los filtros (antes quedaba en lo que
    // sobraba de la altura, casi nada con el celu acostado). En compu (ancha Y alta), igual que siempre.
    <div className="flex flex-col p-3 md:p-6 [@media(min-width:768px)_and_(min-height:560px)]:h-full">
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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white truncate">
                Panel de Gestión
              </h1>
              {/* Compu: solo el punto con las fechas en el tooltip (rediseño, Diego 30/10/2026). */}
              <span className="hidden md:inline-flex"><ActualizadoAl variante="punto" /></span>
            </div>
            <p className="flex md:hidden flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="truncate">Resumen general de operaciones</span>
              <ActualizadoAl />
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 md:flex-row md:items-start md:gap-3">
            {/* Switch Económica / Financiera (punto 4 de Etapa 3): arriba, a la altura del título. */}
            <SwitchEcoFin />
          </div>
        </div>
        <div className="pt-6 pb-4">
          <DashboardFilters />
        </div>
        {/* Tarjetas del último mes cerrado + proyección del que corre (rediseño, Diego 30/10/2026). */}
        <KpiTarjetas />
      </motion.div>

      <div className="h-[calc(100svh-4rem)] [@media(min-width:768px)_and_(min-height:560px)]:h-auto [@media(min-width:768px)_and_(min-height:560px)]:flex-1 min-h-0 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col">
        <DashboardTabContent isFullscreen={isFullscreen} onToggleFullscreen={() => setIsFullscreen(v => !v)} />
      </div>
    </div>
  );
}
