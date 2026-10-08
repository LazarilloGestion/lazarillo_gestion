import { z } from "zod";
import type { DetalleFilter, VentasDetalleFilter } from "./types";

export type Vista = "compras" | "resultados";
export type AgrupacionCompras = "concepto" | "proveedor";

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
  agrupacion?: AgrupacionCompras;
}

export interface VentasDashboardParams {
  year: number;
  localId?: number;
  pdvId?: number;
  months?: number[];
}

// Todo query param de estas rutas es dato externo (CLAUDE.md §2) — se valida
// con Zod en vez de checks manuales. Los `preprocess` reproducen a propósito
// el comportamiento previo (descarte silencioso de valores inválidos, no
// error 400) para no cambiar el contrato de la API en este fix; un id
// inválido o fuera de rango sigue tratándose como "sin filtro".

// Distinto de yearParam/monthsParam: acá "" (param presente pero vacío)
// también cuenta como "sin filtro" — igual que un id ausente o no-numérico.
const optionalIntParam = z.preprocess((v) => {
  if (typeof v !== "string" || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}, z.number().int().optional());

// A diferencia de optionalIntParam, "" acá NO se trata como ausente —
// preserva el comportamiento previo de `sp.get(x)?.slice(n) ?? undefined`,
// donde un string vacío explícito en la URL pasaba igual como "".
const truncatedStringParam = (maxLength: number) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return undefined;
    return v.slice(0, maxLength);
  }, z.string().optional());

const yearParam = z.preprocess((v) => {
  const raw = Number(typeof v === "string" ? v : null);
  return Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : new Date().getFullYear();
}, z.number());

export const monthsParam = z.preprocess((v) => {
  if (typeof v !== "string" || v === "") return undefined;
  const parsed = v.split(",").map(Number).filter((n) => n >= 1 && n <= 12);
  return parsed.length > 0 && parsed.length < 12 ? parsed : undefined;
}, z.array(z.number().int().min(1).max(12)).optional());

// Trunca a 256 (igual que `observacionQuery` en el pivot) en vez de rechazar:
// la paleta guarda el texto completo de la observación (hasta 500), y si el
// detalle descartara el filtro mostraría más compras que la celda clickeada.
export function parseObservacionQuery(raw: string | null): string | undefined {
  return raw ? raw.slice(0, 256) : undefined;
}

const vistaParam = z.preprocess(
  (v) => (v === "resultados" ? "resultados" : undefined),
  z.literal("resultados").optional()
);

const agrupacionParam = z.preprocess(
  (v) => (v === "proveedor" ? "proveedor" : undefined),
  z.literal("proveedor").optional()
);

const dashboardParamsSchema = z.object({
  year: yearParam,
  localId: optionalIntParam,
  pdvId: optionalIntParam,
  rubroCodigo: truncatedStringParam(64),
  conceptoCodigo: truncatedStringParam(64),
  proveedorId: optionalIntParam,
  observacionQuery: truncatedStringParam(256),
  months: monthsParam,
  vista: vistaParam,
  agrupacion: agrupacionParam,
});

const ventasParamsSchema = z.object({
  year: yearParam,
  localId: optionalIntParam,
  pdvId: optionalIntParam,
  months: monthsParam,
});

export function parseDashboardParams(sp: URLSearchParams): DashboardParams {
  return dashboardParamsSchema.parse({
    year: sp.get("year"),
    localId: sp.get("localId"),
    pdvId: sp.get("pdvId"),
    rubroCodigo: sp.get("rubroCodigo"),
    conceptoCodigo: sp.get("conceptoCodigo"),
    proveedorId: sp.get("proveedorId"),
    observacionQuery: sp.get("observacionQuery"),
    months: sp.get("months"),
    vista: sp.get("vista"),
    agrupacion: sp.get("agrupacion"),
  });
}

export function parseVentasParams(sp: URLSearchParams): VentasDashboardParams {
  return ventasParamsSchema.parse({
    year: sp.get("year"),
    localId: sp.get("localId"),
    pdvId: sp.get("pdvId"),
    months: sp.get("months"),
  });
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
  if (params.agrupacion) sp.set("agrupacion", params.agrupacion);
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
  else if (filter.meses?.length) params.set("months", filter.meses.join(","));
  if (filter.observacionQuery) params.set("observacionQuery", filter.observacionQuery);
  if (filter.rubroCodigo) params.set("rubroCodigo", filter.rubroCodigo);
  if (filter.conceptoCodigo) params.set("conceptoCodigo", filter.conceptoCodigo);
  if (filter.proveedorId) params.set("proveedorId", String(filter.proveedorId));
  else if (filter.proveedorTexto) {
    params.set("proveedorTexto", filter.proveedorTexto);
    if (filter.codigo) params.set("codigo", filter.codigo);
  }
  else if (filter.sinProveedor) params.set("sinProveedor", "1");
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

export function buildDiferenciaCajaUrl(year: number, localId?: number, pdvId?: number): string {
  const sp = new URLSearchParams({ year: String(year) });
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("puntoDeVentaId", String(pdvId));
  return `/api/dashboard/diferencia-caja?${sp.toString()}`;
}

export function buildRangoAniosUrl(localId?: number, pdvId?: number): string {
  const sp = new URLSearchParams();
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("puntoDeVentaId", String(pdvId));
  const qs = sp.toString();
  return `/api/dashboard/rango-anios${qs ? `?${qs}` : ""}`;
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
