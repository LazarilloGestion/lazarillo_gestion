"use client";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { PivotTable } from "./pivot-table";
import { VentasPivotTable } from "./ventas-pivot-table";

export function DashboardTabContent() {
  const { tab, switchTab } = useDashboard();

  const tabId = (t: string) => `tab-btn-${t}`;
  const panelId = (t: string) => `tab-panel-${t}`;

  return (
    <>
      <div
        role="tablist"
        aria-label="Vista del dashboard"
        className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50 shrink-0"
      >
        <div className="flex gap-0 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1 bg-zinc-50 dark:bg-zinc-800/50">
          {(["compras", "ventas"] as const).map((t) => (
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
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              )}
            >
              {t === "compras" ? "Compras" : "Ventas"}
            </button>
          ))}
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
    </>
  );
}
