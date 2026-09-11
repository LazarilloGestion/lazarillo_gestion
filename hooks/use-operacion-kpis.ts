"use client";
import { useMemo } from "react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { buildDashboardUrl, buildVentasPivotUrl, type Vista, type AgrupacionCompras } from "@/lib/dashboard/params";
import type { PivotData, PivotDataPorProveedor } from "@/lib/dashboard/types";

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
  agrupacion?: AgrupacionCompras;
}

export function useOperacionKpis<T extends PivotData | PivotDataPorProveedor = PivotData>({
  year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
  months, activeMonths, configVersion, vista, agrupacion,
}: UseOperacionKpisParams) {
  const url = useMemo(() => {
    const base = buildDashboardUrl("/api/dashboard/pivot", {
      year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, months: activeMonths, vista, agrupacion,
    });
    return configVersion > 0 ? `${base}&_rcv=${configVersion}` : base;
  }, [year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, activeMonths, configVersion, vista, agrupacion]);

  const { data, isLoading, error } = useFetchQuery<T>(
    ["pivot", vista ?? "compras", agrupacion ?? "concepto", year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, months, configVersion],
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
