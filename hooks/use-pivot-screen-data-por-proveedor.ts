"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExpandableSet } from "@/hooks/use-expandable-set";
import { flattenRowsPorProveedor, sortPivotRowsPorProveedor, type SortCol, type SortDir } from "@/lib/dashboard/pivot-utils";
import type { PivotDataPorProveedor, DetalleFilter, VentasDetalleFilter } from "@/lib/dashboard/types";
import { buildDetalleFilter, type DetalleFilterExtra } from "@/lib/dashboard/detalle-filter";

interface UsePivotScreenDataPorProveedorParams {
  data: PivotDataPorProveedor | undefined;
  year: number;
  localId?: number;
  pdvId?: number;
  sortCol: SortCol;
  sortDir: SortDir;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
  rubroCodigo?: string;
  activeMonths?: number[];
}

// Hermano de usePivotScreenData (lib/dashboard/pivot-utils.ts), para el árbol
// Rubro → Proveedor → Concepto → línea en vez de Rubro → Concepto → línea.
// Misma forma de retorno a propósito, para que PivotTableByProveedor consuma
// este hook igual que PivotTableByConcepto consume el original.
export function usePivotScreenDataPorProveedor({
  data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery, rubroCodigo, activeMonths,
}: UsePivotScreenDataPorProveedorParams) {
  const { expanded, setExpanded, toggle: toggleRow, collapseAll } = useExpandableSet();
  const [detalleFilter, setDetalleFilter] = useState<DetalleFilter | null>(null);
  const [ventasDetalleFilter, setVentasDetalleFilter] = useState<VentasDetalleFilter | null>(null);
  const prevFilterRef = useRef<{ conceptoCodigo?: string; proveedorId?: number; observacionQuery?: string }>({});

  useEffect(() => {
    if (!data) return;
    const prev = prevFilterRef.current;
    const filterChanged =
      prev.conceptoCodigo !== conceptoCodigo || prev.proveedorId !== proveedorId || prev.observacionQuery !== observacionQuery;
    prevFilterRef.current = { conceptoCodigo, proveedorId, observacionQuery };
    if (!filterChanged) return;

    if (conceptoCodigo || proveedorId || observacionQuery) {
      const ids = new Set<string>();
      for (const rubro of data.rows) {
        ids.add(rubro.id);
        for (const proveedor of rubro.children) {
          ids.add(proveedor.id);
          for (const concepto of proveedor.children) ids.add(concepto.id);
        }
      }
      setExpanded(ids);
    } else {
      setExpanded(new Set());
    }
  }, [data, conceptoCodigo, proveedorId, observacionQuery, setExpanded]);

  // Los totales del pivot vienen acotados por los filtros del dashboard; el modal tiene que mostrar
  // las mismas compras (ver buildDetalleFilter).
  function openDetalle(extra: DetalleFilterExtra) {
    setDetalleFilter(buildDetalleFilter(
      { year, localId, pdvId },
      { rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, activeMonths },
      extra,
    ));
  }

  const sortedRows = useMemo(
    () => (data ? sortPivotRowsPorProveedor(data.rows, sortCol, sortDir) : []),
    [data, sortCol, sortDir]
  );

  const flatRows = useMemo(
    () => flattenRowsPorProveedor({ rows: sortedRows, columnTotals: data?.columnTotals ?? {}, grandTotal: data?.grandTotal ?? 0 }, expanded),
    [sortedRows, expanded, data]
  );

  const rubroIds = useMemo(() => new Set(sortedRows.map((r) => r.id)), [sortedRows]);
  const proveedorIds = useMemo(
    () => new Set(sortedRows.flatMap((r) => r.children.map((p) => p.id))),
    [sortedRows]
  );

  // Click derecho en fila de Proveedor: colapsa proveedor+concepto+línea, mantiene el rubro expandido.
  const collapseProveedores = useCallback((e: React.MouseEvent) => {
    if (navigator.maxTouchPoints > 0) return;
    e.preventDefault();
    setExpanded((prev) => new Set([...prev].filter((id) => rubroIds.has(id))));
  }, [rubroIds, setExpanded]);

  // Click derecho en fila de Concepto: colapsa concepto+línea, mantiene rubro y proveedor expandidos.
  const collapseConceptos = useCallback((e: React.MouseEvent) => {
    if (navigator.maxTouchPoints > 0) return;
    e.preventDefault();
    setExpanded((prev) => new Set([...prev].filter((id) => rubroIds.has(id) || proveedorIds.has(id))));
  }, [rubroIds, proveedorIds, setExpanded]);

  return {
    expanded, toggleRow, collapseAll, collapseProveedores, collapseConceptos,
    sortedRows, flatRows, isEmpty: flatRows.length === 0,
    detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  };
}
