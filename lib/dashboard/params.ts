import type { DetalleFilter, VentasDetalleFilter } from "./types";

export type Vista = "compras" | "resultados";

export interface DashboardParams {
  year: number;
  localId?: number;
  pdvId?: number;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
  months?: number[];
  vista?: Vista;
}

export interface VentasDashboardParams {
  year: number;
  localId?: number;
  pdvId?: number;
  months?: number[];
}

function toInt(s: string | null): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isInteger(n) ? n : undefined;
}

function parseMonths(s: string | null): number[] | undefined {
  if (!s) return undefined;
  const parsed = s.split(",").map(Number).filter((n) => n >= 1 && n <= 12);
  return parsed.length > 0 && parsed.length < 12 ? parsed : undefined;
}

function parseVista(s: string | null): Vista | undefined {
  return s === "resultados" ? "resultados" : undefined;
}

export function parseDashboardParams(sp: URLSearchParams): DashboardParams {
  const raw = Number(sp.get("year"));
  const year = Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : new Date().getFullYear();
  return {
    year,
    localId: toInt(sp.get("localId")),
    pdvId: toInt(sp.get("pdvId")),
    rubroCodigo: sp.get("rubroCodigo")?.slice(0, 64) ?? undefined,
    conceptoCodigo: sp.get("conceptoCodigo")?.slice(0, 64) ?? undefined,
    proveedorId: toInt(sp.get("proveedorId")),
    observacionQuery: sp.get("observacionQuery")?.slice(0, 256) ?? undefined,
    months: parseMonths(sp.get("months")),
    vista: parseVista(sp.get("vista")),
  };
}

export function parseVentasParams(sp: URLSearchParams): VentasDashboardParams {
  const raw = Number(sp.get("year"));
  const year = Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : new Date().getFullYear();
  return {
    year,
    localId: toInt(sp.get("localId")),
    pdvId: toInt(sp.get("pdvId")),
    months: parseMonths(sp.get("months")),
  };
}

export function buildDashboardUrl(base: string, params: DashboardParams): string {
  const sp = new URLSearchParams({ year: String(params.year) });
  if (params.localId != null) sp.set("localId", String(params.localId));
  if (params.pdvId != null) sp.set("pdvId", String(params.pdvId));
  if (params.rubroCodigo) sp.set("rubroCodigo", params.rubroCodigo);
  if (params.conceptoCodigo) sp.set("conceptoCodigo", params.conceptoCodigo);
  if (params.proveedorId != null) sp.set("proveedorId", String(params.proveedorId));
  if (params.observacionQuery) sp.set("observacionQuery", params.observacionQuery);
  if (params.months?.length) sp.set("months", params.months.join(","));
  if (params.vista) sp.set("vista", params.vista);
  return `${base}?${sp.toString()}`;
}

export function buildVentasPivotUrl(base: string, params: Pick<VentasDashboardParams, "year" | "localId" | "pdvId" | "months">): string {
  const sp = new URLSearchParams({ year: String(params.year) });
  if (params.localId != null) sp.set("localId", String(params.localId));
  if (params.pdvId != null) sp.set("pdvId", String(params.pdvId));
  if (params.months?.length) sp.set("months", params.months.join(","));
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
  if (filter.rowId) params.set("rowId", filter.rowId);
  if (filter.distribucionId != null) params.set("distribucionId", String(filter.distribucionId));
  return `/api/dashboard/detalle?${params}`;
}

export function buildFlujoCajaUrl(year: number, localId?: number, pdvId?: number): string {
  const sp = new URLSearchParams({ anio: String(year) });
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("puntoDeVentaId", String(pdvId));
  return `/api/dashboard/flujo-caja?${sp.toString()}`;
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
