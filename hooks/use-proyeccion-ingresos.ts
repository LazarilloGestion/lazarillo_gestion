"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";
import type { ProyeccionMes } from "@/lib/dashboard/proyeccion";

// Proyección de cierre del mes con ventas incompletas, con los mismos filtros
// de local/PDV que la fila de Ingresos. null cuando no hay mes para proyectar.
export function useProyeccionIngresos(): ProyeccionMes | null {
  const { year, localId, pdvId } = useDashboard();
  const sp = new URLSearchParams({ year: String(year) });
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("pdvId", String(pdvId));
  const { data } = useFetchQuery<{ proyeccion: ProyeccionMes | null }>(
    ["proyeccion-ingresos", year, localId, pdvId],
    `/api/dashboard/proyeccion?${sp.toString()}`,
    { staleTime: 5 * 60_000 }
  );
  return data?.proyeccion ?? null;
}
