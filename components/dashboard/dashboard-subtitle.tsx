"use client";
import { useDashboard } from "@/hooks/use-dashboard-store";

const SUBTITLES: Record<string, string> = {
  compras: "Vista anual por rubro / tipo de cobro",
  ventas: "Vista anual por punto de venta / tipo de cobro",
};

export function DashboardSubtitle() {
  const { tab } = useDashboard();
  return (
    <p className="text-sm text-zinc-500 dark:text-zinc-400">
      {SUBTITLES[tab] ?? SUBTITLES.compras}
    </p>
  );
}
