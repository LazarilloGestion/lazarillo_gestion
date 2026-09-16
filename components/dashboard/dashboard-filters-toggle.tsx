"use client";
import { usePathname } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { useFiltersPanel } from "@/hooks/use-dashboard-store";

// Botón de colapsar el panel del dashboard, montado en el header del shell.
// Solo se muestra en /dashboard. Incluye el divisor hacia el theme toggle
// para que la barra desaparezca junto con el botón en otras rutas.
export function DashboardFiltersToggle() {
  const pathname = usePathname();
  const { showFilters, toggleFilters } = useFiltersPanel();
  if (pathname !== "/dashboard") return null;
  return (
    <>
      <button
        onClick={toggleFilters}
        title={showFilters ? "Ocultar panel" : "Mostrar panel"}
        // showFilters se seedea sincrónicamente desde localStorage en el cliente
        // (ver hooks/use-dashboard-store.ts) — el servidor siempre renderiza con
        // el default del módulo, así que este title puede legítimamente diferir
        // entre SSR y el primer render de cliente. Mismo criterio que el
        // suppressHydrationWarning de dashboard-content.tsx.
        suppressHydrationWarning
        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      <div aria-hidden className="h-5 w-px mx-0.5 bg-border/60" />
    </>
  );
}
