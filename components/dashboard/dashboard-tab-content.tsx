"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PivotTable } from "./pivot-table";
import { VentasPivotTable } from "./ventas-pivot-table";

// Filtros exclusivos de cada tab (se guardan/restauran con prefijo al cambiar)
const COMPRAS_FILTER_KEYS = ["rubroCodigo", "conceptoCodigo", "proveedorId", "_searchLabel"];
const VENTAS_FILTER_KEYS: string[] = []; // ventas no tiene filtros de palette por ahora

const TAB_FILTER_KEYS: Record<string, string[]> = {
  compras: COMPRAS_FILTER_KEYS,
  ventas: VENTAS_FILTER_KEYS,
};

export function DashboardTabContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get("tab") ?? "compras";

  function switchTab(tab: string) {
    const params = new URLSearchParams(searchParams.toString());

    // Guardar filtros del tab actual con prefijo antes de cambiar
    const currentTab = activeTab;
    const currentKeys = TAB_FILTER_KEYS[currentTab] ?? [];
    for (const key of currentKeys) {
      const val = params.get(key);
      if (val) {
        params.set(`_saved_${currentTab}_${key}`, val);
      } else {
        params.delete(`_saved_${currentTab}_${key}`);
      }
      params.delete(key);
    }

    // Restaurar filtros guardados del tab destino
    const targetKeys = TAB_FILTER_KEYS[tab] ?? [];
    for (const key of targetKeys) {
      const saved = params.get(`_saved_${tab}_${key}`);
      if (saved) {
        params.set(key, saved);
      } else {
        params.delete(key);
      }
    }

    params.set("tab", tab);
    router.replace(`/dashboard?${params.toString()}`);
  }

  const tabId = (tab: string) => `tab-btn-${tab}`;
  const panelId = (tab: string) => `tab-panel-${tab}`;

  return (
    <>
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Vista del dashboard"
        className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50 shrink-0"
      >
        <div className="flex gap-0 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1 bg-zinc-50 dark:bg-zinc-800/50">
          {(["compras", "ventas"] as const).map((tab) => (
            <button
              key={tab}
              id={tabId(tab)}
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={panelId(tab)}
              onClick={() => switchTab(tab)}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-150 capitalize",
                activeTab === tab
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              )}
            >
              {tab === "compras" ? "Compras" : "Ventas"}
            </button>
          ))}
        </div>
      </div>

      {/* Panels */}
      <div
        id={panelId("compras")}
        role="tabpanel"
        aria-labelledby={tabId("compras")}
        hidden={activeTab !== "compras"}
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {activeTab === "compras" && <PivotTable />}
      </div>

      <div
        id={panelId("ventas")}
        role="tabpanel"
        aria-labelledby={tabId("ventas")}
        hidden={activeTab !== "ventas"}
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {activeTab === "ventas" && <VentasPivotTable />}
      </div>
    </>
  );
}
