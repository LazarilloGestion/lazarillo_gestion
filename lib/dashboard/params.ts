export interface DashboardParams {
  year: number;
  localId?: number;
  pdvId?: number;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
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

export function buildDashboardUrl(base: string, params: DashboardParams): string {
  const sp = new URLSearchParams({ year: String(params.year) });
  if (params.localId != null) sp.set("localId", String(params.localId));
  if (params.pdvId != null) sp.set("pdvId", String(params.pdvId));
  if (params.rubroCodigo) sp.set("rubroCodigo", params.rubroCodigo);
  if (params.conceptoCodigo) sp.set("conceptoCodigo", params.conceptoCodigo);
  if (params.proveedorId != null) sp.set("proveedorId", String(params.proveedorId));
  return `${base}?${sp.toString()}`;
}
