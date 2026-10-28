"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useProyeccionIngresos } from "@/hooks/use-proyeccion-ingresos";
import { egresosProyectados, type EgresosProyectados, type MesAnual } from "@/lib/dashboard/egresos-proy";
import type { ItemSinCarga, MesSinCarga } from "@/lib/sin-carga/estado";

export interface FaltaCargar { n: number; total: number; items: ItemSinCarga[] }

// Fila Egresos del tablero (Diego 28/10/2026): proyección del mes en curso y, en los meses
// cerrados, lo que falta cargar (Sin carga). Solo en la Económica y sin búsqueda activa: con un
// filtro de proveedor/concepto la proyección por rubro no tiene sentido.
export function useEgresosProyeccion(egresosPorMes: Record<number, number>) {
  const { year, localId, pdvId, modoPanel, activeSearchParam } = useDashboard();
  const proy = useProyeccionIngresos();
  const activo = modoPanel === "economica" && !activeSearchParam;
  const mesProy = activo && proy && proy.anio === year ? proy.mes : null;
  const sp = new URLSearchParams({ anio: String(year) });
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("pdvId", String(pdvId));
  const { data: anual } = useFetchQuery<{ meses: MesAnual[] }>(
    ["m-anual", localId, pdvId, year], mesProy ? `/api/m/anual?${sp.toString()}` : null, { staleTime: 10 * 60_000 });
  const { data: sc } = useFetchQuery<{ meses: MesSinCarga[] }>(
    ["sin-carga", pdvId], activo && pdvId != null ? `/api/sin-carga?pdvId=${pdvId}` : null, { staleTime: 60_000 });

  const delMes = (mes: number) => sc?.meses.find((m) => m.mes === `${year}-${String(mes).padStart(2, "0")}`)?.items ?? [];
  const proyectado: EgresosProyectados | null = mesProy && anual && egresosPorMes[mesProy] != null
    ? egresosProyectados({ anual: anual.meses, mesProy, ventasProy: proy!.proyeccion, cargadoPivot: egresosPorMes[mesProy], sinCargar: delMes(mesProy) })
    : null;
  // Meses cerrados con algo sin cargar (el de la proyección ya lo incluye).
  const faltan: Record<number, FaltaCargar> = {};
  if (activo && sc) for (const m of sc.meses) {
    const [a, mm] = m.mes.split("-").map(Number);
    if (a !== year || mm === mesProy || !m.items.length) continue;
    const items = [...m.items].sort((x, y) => y.ultimo - x.ultimo);
    faltan[mm] = { n: items.length, total: items.reduce((s, x) => s + x.ultimo, 0), items };
  }
  return { proyectado, ventasProy: proyectado ? proy!.proyeccion : null, faltan };
}
