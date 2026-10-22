import type { DetalleFilter } from "./types";

export type DetalleFilterBase = Pick<DetalleFilter, "year" | "localId" | "pdvId">;

// Filtros activos del dashboard (useDashboard). activeMonths es undefined con los 12 meses.
export interface DetalleFiltrosGlobales {
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
  importeQuery?: string;
  activeMonths?: number[];
}

// Lo que trae el click de una celda — observación y meses solo llegan por los globales.
export type DetalleFilterExtra = Omit<DetalleFilter, "year" | "localId" | "pdvId" | "observacionQuery" | "importeQuery" | "meses">;

// Arma el filtro del modal de detalle para que muestre exactamente las compras que suma la celda
// clickeada: los totales del pivot ya vienen acotados por los filtros globales, así que el modal
// también. Ante un choque gana lo del click, que es lo más específico.
export function buildDetalleFilter(
  base: DetalleFilterBase,
  globales: DetalleFiltrosGlobales,
  extra: DetalleFilterExtra,
): DetalleFilter {
  // La API resuelve un registro puntual por rowId e ignora el resto; no arrastrar globales evita
  // que el mismo registro tenga distintos queryKey según los filtros activos.
  if (extra.rowId) return { ...base, rowId: extra.rowId, distribucionId: extra.distribucionId };

  const clickTraeProveedor =
    extra.proveedorId != null || extra.proveedorTexto != null || extra.sinProveedor === true;

  return {
    ...base,
    rubroCodigo: globales.rubroCodigo,
    conceptoCodigo: globales.conceptoCodigo,
    // proveedorId gana sobre proveedorTexto/sinProveedor en la URL — si el click es de una fila
    // de proveedor, el global taparía la fila clickeada.
    proveedorId: clickTraeProveedor ? undefined : globales.proveedorId,
    observacionQuery: globales.observacionQuery,
    importeQuery: globales.importeQuery,
    meses: extra.mes ? undefined : globales.activeMonths,
    ...extra,
  };
}
