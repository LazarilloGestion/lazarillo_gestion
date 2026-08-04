"use client";
import { useQueries } from "@tanstack/react-query";
import { buildDashboardUrl, buildVentasPivotUrl, buildFlujoCajaUrl } from "@/lib/dashboard/params";
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import { diferenciaCaja, computeDiferenciaCajaAcumulada } from "@/lib/dashboard/resultados-calc";
import type { PivotData } from "@/lib/dashboard/types";

// Primer año con datos operables en el sistema — acota hasta dónde hay que ir a buscar el
// arrastre histórico. Vive acá (no en lib/dashboard/constants.ts, compartido con Compras/Ventas)
// porque esta pantalla es la única que necesita "cerrar" años anteriores; el selector de años
// de dashboard-filters.tsx/filters-drawer.tsx tiene su propio límite hardcodeado por separado.
const FIRST_DATA_YEAR = 2025;

interface FlujoCajaResponse {
  anio: number;
  meses: Record<number, number | null>;
}

interface YearTotals {
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  gananciaPorMes: Record<number, number>;
  flujoPorMes: Record<number, number>;
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
// cualquier filtro de columnas activo en pantalla — el acumulado siempre necesita el año entero.
async function fetchYearTotals(year: number, localId?: number, pdvId?: number): Promise<YearTotals> {
  const [ventas, compras, ganancia, flujo] = await Promise.all([
    fetchJson<PivotData>(buildVentasPivotUrl("/api/dashboard/pivot-ventas", { year, localId, pdvId, months: undefined })),
    fetchJson<PivotData>(buildDashboardUrl("/api/dashboard/pivot", { year, localId, pdvId, vista: "compras" })),
    fetchJson<PivotData>(buildDashboardUrl("/api/dashboard/pivot", { year, localId, pdvId, vista: "resultados" })),
    fetchJson<FlujoCajaResponse>(buildFlujoCajaUrl(year, localId, pdvId)),
  ]);
  const flujoPorMes: Record<number, number> = {};
  for (const [mes, monto] of Object.entries(flujo.meses)) flujoPorMes[Number(mes)] = monto ?? 0;
  return {
    ingresosPorMes: ventas.columnTotals,
    egresosPorMes: compras.columnTotals,
    gananciaPorMes: ganancia.columnTotals,
    flujoPorMes,
  };
}

function sumYearDiferencia(totals: YearTotals): number {
  return MONTH_IDXS.reduce(
    (sum, mes) => sum + diferenciaCaja(
      totals.ingresosPorMes[mes], totals.egresosPorMes[mes], totals.gananciaPorMes[mes], totals.flujoPorMes[mes],
    ),
    0,
  );
}

// Saldo acumulado de "Diferencia de caja" para cada mes de `year`, arrastrando el cierre de
// los años anteriores (desde FIRST_DATA_YEAR) para que Enero no arranque de cero.
export function useDiferenciaCajaAcumulada({ year, localId, pdvId }: Params) {
  const previousYears = Array.from(
    { length: Math.max(year - FIRST_DATA_YEAR, 0) },
    (_, i) => FIRST_DATA_YEAR + i,
  );
  const years = [...previousYears, year];

  const queries = useQueries({
    queries: years.map((y) => ({
      queryKey: ["diferencia-caja-year-totals", y, localId, pdvId],
      queryFn: () => fetchYearTotals(y, localId, pdvId),
      staleTime: 30_000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);

  const currentYearTotals = queries[queries.length - 1]?.data;

  if (!currentYearTotals || isError) {
    return { acumuladoPorMes: {} as Record<number, number>, isLoading, isError };
  }

  const saldoInicial = queries
    .slice(0, previousYears.length)
    .reduce((carry, q) => (q.data ? carry + sumYearDiferencia(q.data) : carry), 0);

  const diferenciaPorMes: Record<number, number> = {};
  for (const mes of MONTH_IDXS) {
    diferenciaPorMes[mes] = diferenciaCaja(
      currentYearTotals.ingresosPorMes[mes],
      currentYearTotals.egresosPorMes[mes],
      currentYearTotals.gananciaPorMes[mes],
      currentYearTotals.flujoPorMes[mes],
    );
  }

  const acumuladoPorMes = computeDiferenciaCajaAcumulada(MONTH_IDXS, diferenciaPorMes, saldoInicial);
  return { acumuladoPorMes, isLoading, isError };
}
