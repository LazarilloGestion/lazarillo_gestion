"use client";
import { useQueries } from "@tanstack/react-query";
import { buildDashboardUrl, buildVentasPivotUrl, buildFlujoCajaUrl } from "@/lib/dashboard/params";
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import { diferenciaCajaMensual } from "@/lib/dashboard/resultados-calc";
import type { PivotData } from "@/lib/dashboard/types";

// Primer año con datos operables en el sistema — enero de este año no tiene diciembre anterior
// para arrastrar, así que no calcula Diferencia (va en "—"). Vive acá (no en
// lib/dashboard/constants.ts, compartido con Compras/Ventas) porque esta pantalla es la única que
// necesita el mes anterior entre años; el selector de años de dashboard-filters.tsx/filters-drawer.tsx
// tiene su propio límite hardcodeado por separado.
const FIRST_DATA_YEAR = 2025;

interface FlujoCajaResponse {
  anio: number;
  meses: Record<number, number | null>;
}

interface YearTotals {
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  gananciaPorMes: Record<number, number>;
  disponiblePorMes: Record<number, number | null>;
}

interface Params {
  year: number;
  localId?: number;
  pdvId?: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error cargando ${url}`);
  return res.json() as Promise<T>;
}

// Trae los 4 totales mensuales del año completo (sin filtro de meses), independiente de
// cualquier filtro de columnas activo en pantalla.
async function fetchYearTotals(year: number, localId?: number, pdvId?: number): Promise<YearTotals> {
  const [ventas, compras, ganancia, flujo] = await Promise.all([
    fetchJson<PivotData>(buildVentasPivotUrl("/api/dashboard/pivot-ventas", { year, localId, pdvId, months: undefined })),
    fetchJson<PivotData>(buildDashboardUrl("/api/dashboard/pivot", { year, localId, pdvId, vista: "compras" })),
    fetchJson<PivotData>(buildDashboardUrl("/api/dashboard/pivot", { year, localId, pdvId, vista: "resultados" })),
    fetchJson<FlujoCajaResponse>(buildFlujoCajaUrl(year, localId, pdvId)),
  ]);
  return {
    ingresosPorMes: ventas.columnTotals,
    egresosPorMes: compras.columnTotals,
    gananciaPorMes: ganancia.columnTotals,
    // Se preserva null (sin arqueo cargado) — no default a 0, es lo que distingue "—" de "$0".
    disponiblePorMes: flujo.meses,
  };
}

async function fetchDiciembreAnterior(year: number, localId?: number, pdvId?: number): Promise<number | null> {
  const flujo = await fetchJson<FlujoCajaResponse>(buildFlujoCajaUrl(year - 1, localId, pdvId));
  return flujo.meses[12] ?? null;
}

// Diferencia de caja por mes de `year` (modelo mensual independiente, no acumulado — ver
// diferenciaCajaMensual). Enero arrastra el disponible de diciembre del año anterior.
export function useDiferenciaCaja({ year, localId, pdvId }: Params) {
  const necesitaDiciembreAnterior = year > FIRST_DATA_YEAR;

  const queries = useQueries({
    queries: [
      {
        queryKey: ["diferencia-caja-year-totals", year, localId, pdvId],
        queryFn: () => fetchYearTotals(year, localId, pdvId),
        staleTime: 30_000,
      },
      {
        queryKey: ["diferencia-caja-diciembre-anterior", year, localId, pdvId],
        queryFn: () => fetchDiciembreAnterior(year, localId, pdvId),
        staleTime: 30_000,
        enabled: necesitaDiciembreAnterior,
      },
    ],
  });

  const [totalsQuery, diciembreAnteriorQuery] = queries;
  const isLoading = totalsQuery.isLoading || (necesitaDiciembreAnterior && diciembreAnteriorQuery.isLoading);
  // Si falla la query de diciembre anterior, solo enero se queda sin dato (ver más abajo,
  // diciembreAnterior cae a null → diferenciaCajaMensual devuelve null para enero) — no hace
  // falta tirar abajo los otros 11 meses, que no dependen de esa query.
  const isError = totalsQuery.isError;

  if (!totalsQuery.data || isError) {
    return { diferenciaPorMes: {} as Record<number, number | null>, isLoading, isError };
  }

  const totals = totalsQuery.data;
  const diciembreAnterior = necesitaDiciembreAnterior ? diciembreAnteriorQuery.data ?? null : null;

  const diferenciaPorMes: Record<number, number | null> = {};
  for (const mes of MONTH_IDXS) {
    const disponibleMesAnterior = mes === 1 ? diciembreAnterior : totals.disponiblePorMes[mes - 1];
    diferenciaPorMes[mes] = diferenciaCajaMensual(
      totals.disponiblePorMes[mes],
      disponibleMesAnterior,
      (totals.ingresosPorMes[mes] ?? 0) - (totals.egresosPorMes[mes] ?? 0),
      totals.gananciaPorMes[mes],
    );
  }

  return { diferenciaPorMes, isLoading, isError };
}
