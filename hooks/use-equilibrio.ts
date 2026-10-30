"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";

export interface EquilibrioData {
  porMes: Record<number, { total: number; detalle: { nombre: string; total: number }[] }>;
  variables: { tipo: "rubro" | "concepto"; nombre: string; pct: number }[];
}

// Gastos variables por mes para la fila "Punto de equilibrio" (Diego 30/10/2026). Como la
// proyección de egresos: solo en la Económica y sin búsqueda activa (con un filtro de proveedor
// o concepto los egresos de la fila ya no son todos los gastos y el equilibrio no tiene sentido).
export function useEquilibrio(): { data: EquilibrioData | null; activo: boolean } {
  const { year, localId, pdvId, modoPanel, activeSearchParam } = useDashboard();
  const activo = modoPanel === "economica" && !activeSearchParam;
  const sp = new URLSearchParams({ year: String(year) });
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("pdvId", String(pdvId));
  const { data } = useFetchQuery<EquilibrioData>(
    ["equilibrio", year, localId, pdvId], activo ? `/api/dashboard/equilibrio?${sp.toString()}` : null, { staleTime: 10 * 60_000 });
  return { data: activo ? data ?? null : null, activo };
}
