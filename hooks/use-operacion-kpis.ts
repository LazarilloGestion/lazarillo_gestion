"use client";
import { useMemo } from "react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { buildDashboardUrl, buildVentasPivotUrl, type Vista } from "@/lib/dashboard/params";
import type { PivotData } from "@/lib/dashboard/types";

interface UseOperacionKpisParams {
  year: number;
  localId?: number;
  pdvId?: number;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
  months: number[];
  activeMonths?: number[];
  configVersion: number;
  vista?: Vista;
}

export function useOperacionKpis({
  year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
  months, activeMonths, configVersion, vista,
}: UseOperacionKpisParams) {
  const url = useMemo(() => {
    const base = buildDashboardUrl("/api/dashboard/pivot", {
      year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, months: activeMonths, vista,
    });
    return configVersion > 0 ? `${base}&_rcv=${configVersion}` : base;
  }, [year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, activeMonths, configVersion, vista]);

  const { data, isLoading, error } = useFetchQuery<PivotData>(
    ["pivot", vista ?? "compras", year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, months, configVersion],
    url
  );

  const ventasUrl = useMemo(
    () => buildVentasPivotUrl("/api/dashboard/pivot-ventas", { year, localId, pdvId, months: activeMonths }),
    [year, localId, pdvId, activeMonths]
  );

  const { data: ventasData, isLoading: ventasLoading } = useFetchQuery<PivotData>(
    ["pivot-ventas", year, localId, pdvId, months],
    ventasUrl
  );

  return { data, isLoading, error, ventasData, ventasLoading };
}
