"use client";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { PivotTable } from "./pivot-table";
import { VentasPivotTable } from "./ventas-pivot-table";
import { ResultadosPivotTable } from "./resultados-pivot-table";
import { Maximize2, Minimize2 } from "lucide-react";
import { VistaTablaToggles } from "./vista-tabla-toggles";

interface DashboardTabContentProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function DashboardTabContent({ isFullscreen, onToggleFullscreen }: DashboardTabContentProps) {
  const { tab, switchTab } = useDashboard();
  const tabId = (t: string) => `tab-btn-${t}`;
  const panelId = (t: string) => `tab-panel-${t}`;

  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onToggleFullscreen(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen, onToggleFullscreen]);

  return (
    <motion.div
      initial={false}
      animate={isFullscreen ? { opacity: [0.85, 1], scale: [0.98, 1] } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        "flex flex-col bg-white dark:bg-zinc-900",
        isFullscreen ? "fixed inset-0 z-50" : "h-full"
      )}
    >
      <div
        role="tablist"
        aria-label="Vista del panel de gestión"
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50 shrink-0"
      >
        <div className="flex gap-0 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1 bg-zinc-50 dark:bg-zinc-800/50">
          {(["compras", "ventas", "resultados"] as const).map((t) => (
            <button
              key={t}
              id={tabId(t)}
              role="tab"
              aria-selected={tab === t}
              aria-controls={panelId(t)}
              onClick={() => switchTab(t)}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-150 capitalize",
                tab === t
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                  : "text-muted-foreground hover:text-zinc-700 dark:hover:text-zinc-200"
              )}
            >
              {t === "compras" ? "Compras" : t === "ventas" ? "Ventas" : "Resultados"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {tab === "compras" && <VistaTablaToggles />}
        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? "Salir de pantalla completa (Esc)" : "Pantalla completa"}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        </div>
      </div>

      <div
        id={panelId("compras")}
        role="tabpanel"
        aria-labelledby={tabId("compras")}
        hidden={tab !== "compras"}
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {tab === "compras" && <PivotTable />}
      </div>

      <div
        id={panelId("ventas")}
        role="tabpanel"
        aria-labelledby={tabId("ventas")}
        hidden={tab !== "ventas"}
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {tab === "ventas" && <VentasPivotTable />}
      </div>

      <div
        id={panelId("resultados")}
        role="tabpanel"
        aria-labelledby={tabId("resultados")}
        hidden={tab !== "resultados"}
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {tab === "resultados" && <ResultadosPivotTable />}
      </div>
    </motion.div>
  );
}
