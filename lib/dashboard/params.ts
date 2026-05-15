export interface DashboardParams {
  year: number;
  localId?: number;
  pdvId?: number;
}

export function parseDashboardParams(sp: URLSearchParams): DashboardParams {
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const localIdStr = sp.get("localId");
  const pdvIdStr = sp.get("pdvId");
  return {
    year,
    localId: localIdStr ? Number(localIdStr) : undefined,
    pdvId: pdvIdStr ? Number(pdvIdStr) : undefined,
  };
}

export function buildDashboardUrl(base: string, params: DashboardParams): string {
  const sp = new URLSearchParams({ year: String(params.year) });
  if (params.localId) sp.set("localId", String(params.localId));
  if (params.pdvId) sp.set("pdvId", String(params.pdvId));
  return `${base}?${sp.toString()}`;
}
