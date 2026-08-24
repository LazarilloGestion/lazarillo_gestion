"use client";
import { useQueries } from "@tanstack/react-query";
import { buildDashboardUrl, buildVentasPivotUrl, buildFlujoCajaUrl, buildPrimerArqueoUrl } from "@/lib/dashboard/params";
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import { computeDiferenciaCajaAcumulada, type MesDatos } from "@/lib/dashboard/resultados-calc";
import type { PivotData } from "@/lib/dashboard/types";

interface FlujoCajaResponse {
  anio: number;
  meses: Record<number, number | null>;
}

interface PrimerArqueoResponse {
  primerArqueo: { anio: number; mes: number } | null;
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

function toSerieDeUnAnio(anio: number, totals: YearTotals): MesDatos[] {
  return MONTH_IDXS.map((mes) => ({
    anio,
    mes,
    ingresos: totals.ingresosPorMes[mes] ?? 0,
    egresos: totals.egresosPorMes[mes] ?? 0,
    ganancia: totals.gananciaPorMes[mes] ?? 0,
    disponible: totals.disponiblePorMes[mes] ?? null,
  }));
}

// Diferencia de caja acumulada (ver Fix_Diferencia_Caja.pdf y
// docs/superpowers/specs/2026-08-24-fix-diferencia-caja-design.md): arranca en el mes siguiente
// al primer arqueo cargado, acumulando como un resumen bancario. Si el primer arqueo está en un
// año anterior a `year`, se trae la serie continua desde ese año para no perder el arrastre.
export function useDiferenciaCaja({ year, localId, pdvId }: Params) {
  const primerArqueoQuery = useQueries({
    queries: [
      {
        queryKey: ["diferencia-caja-primer-arqueo", localId, pdvId],
        queryFn: () => fetchJson<PrimerArqueoResponse>(buildPrimerArqueoUrl(localId, pdvId)),
        staleTime: 30_000,
      },
    ],
  })[0];

  const primerArqueo = primerArqueoQuery.data?.primerArqueo ?? null;
  const necesitaTotales = !primerArqueoQuery.isLoading && !primerArqueoQuery.isError && primerArqueo != null && primerArqueo.anio <= year;

  const anios: number[] = necesitaTotales
    ? Array.from({ length: year - primerArqueo!.anio + 1 }, (_, i) => primerArqueo!.anio + i)
    : [];

  const totalesQueries = useQueries({
    queries: anios.map((anio) => ({
      queryKey: ["diferencia-caja-year-totals", anio, localId, pdvId],
      queryFn: () => fetchYearTotals(anio, localId, pdvId),
      staleTime: 30_000,
    })),
  });

  const isLoading = primerArqueoQuery.isLoading || (necesitaTotales && totalesQueries.some((q) => q.isLoading));
  const isError = primerArqueoQuery.isError || totalesQueries.some((q) => q.isError);

  if (isLoading || isError || !necesitaTotales) {
    const diferenciaPorMes: Record<number, number | null> = {};
    for (const mes of MONTH_IDXS) diferenciaPorMes[mes] = null;
    return { diferenciaPorMes, isLoading, isError };
  }

  const serie: MesDatos[] = anios.flatMap((anio, idx) => toSerieDeUnAnio(anio, totalesQueries[idx].data as YearTotals));
  const acumulado = computeDiferenciaCajaAcumulada(serie, primerArqueo);

  const offsetDelAnioObjetivo = (year - primerArqueo!.anio) * 12;
  const diferenciaPorMes: Record<number, number | null> = {};
  for (const mes of MONTH_IDXS) {
    diferenciaPorMes[mes] = acumulado[offsetDelAnioObjetivo + (mes - 1)];
  }

  return { diferenciaPorMes, isLoading, isError };
}
