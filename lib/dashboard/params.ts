import type { DetalleFilter, VentasDetalleFilter } from "./types";

export interface DashboardParams {
  year: number;
  localId?: number;
  pdvId?: number;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
}

export interface VentasDashboardParams {
  year: number;
  localId?: number;
  pdvId?: number;
  tipoCodigo?: string;
  cobroCodigo?: string;
}

function toInt(s: string | null): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isInteger(n) ? n : undefined;
}

export function parseDashboardParams(sp: URLSearchParams): DashboardParams {
  const year = Number(sp.get("year")) || new Date().getFullYear();
  return {
    year,
    localId: toInt(sp.get("localId")),
    pdvId: toInt(sp.get("pdvId")),
    rubroCodigo: sp.get("rubroCodigo") ?? undefined,
    conceptoCodigo: sp.get("conceptoCodigo") ?? undefined,
    proveedorId: toInt(sp.get("proveedorId")),
  };
}

export function parseVentasParams(sp: URLSearchParams): VentasDashboardParams {
  const year = Number(sp.get("year")) || new Date().getFullYear();
  return {
    year,
    localId: toInt(sp.get("localId")),
    pdvId: toInt(sp.get("pdvId")),
    tipoCodigo: sp.get("tipoCodigo") ?? undefined,
    cobroCodigo: sp.get("cobroCodigo") ?? undefined,
  };
}

export function buildDashboardUrl(base: string, params: DashboardParams): string {
  const sp = new URLSearchParams({ year: String(params.year) });
  if (params.localId != null) sp.set("localId", String(params.localId));
  if (params.pdvId != null) sp.set("pdvId", String(params.pdvId));
  if (params.rubroCodigo) sp.set("rubroCodigo", params.rubroCodigo);
  if (params.conceptoCodigo) sp.set("conceptoCodigo", params.conceptoCodigo);
  if (params.proveedorId != null) sp.set("proveedorId", String(params.proveedorId));
  return `${base}?${sp.toString()}`;
}

export function buildVentasPivotUrl(base: string, params: Pick<VentasDashboardParams, "year" | "localId" | "pdvId">): string {
  const sp = new URLSearchParams({ year: String(params.year) });
  if (params.localId != null) sp.set("localId", String(params.localId));
  if (params.pdvId != null) sp.set("pdvId", String(params.pdvId));
  return `${base}?${sp.toString()}`;
}

export function buildComprasDetalleUrl(filter: DetalleFilter): string {
  const params = new URLSearchParams({ year: String(filter.year) });
  if (filter.localId) params.set("localId", String(filter.localId));
  if (filter.pdvId) params.set("pdvId", String(filter.pdvId));
  if (filter.mes) params.set("mes", String(filter.mes));
  if (filter.rubroCodigo) params.set("rubroCodigo", filter.rubroCodigo);
  if (filter.conceptoCodigo) params.set("conceptoCodigo", filter.conceptoCodigo);
  if (filter.proveedorId) params.set("proveedorId", String(filter.proveedorId));
  return `/api/dashboard/detalle?${params}`;
}

export function buildVentasDetalleUrl(filter: VentasDetalleFilter): string {
  const params = new URLSearchParams({ year: String(filter.year) });
  if (filter.localId) params.set("localId", String(filter.localId));
  if (filter.pdvId) params.set("pdvId", String(filter.pdvId));
  if (filter.mes) params.set("mes", String(filter.mes));
  if (filter.tipoCodigo) params.set("tipoCodigo", filter.tipoCodigo);
  if (filter.cobroCodigo) params.set("cobroCodigo", filter.cobroCodigo);
  return `/api/dashboard/detalle-ventas?${params}`;
}
