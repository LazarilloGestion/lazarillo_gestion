"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExpandableSet } from "@/hooks/use-expandable-set";
import { flattenRows, sortPivotRows, type SortCol, type SortDir } from "@/lib/dashboard/pivot-utils";
import type { PivotData, DetalleFilter, VentasDetalleFilter } from "@/lib/dashboard/types";
import { buildDetalleFilter, type DetalleFilterExtra } from "@/lib/dashboard/detalle-filter";

interface UsePivotScreenDataParams {
  data: PivotData | undefined;
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

// Estado/orquestación compartido entre PivotTable (Compras) y useResultadosData (Resultados):
// auto-expandir en filtro, drill-down (openDetalle), orden/aplanado del árbol pivot, colapso
// de conceptos con click derecho. Extraído tras aparecer duplicado byte a byte en ambas pantallas.
export function usePivotScreenData({
  data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery, rubroCodigo, activeMonths,
}: UsePivotScreenDataParams) {
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
        for (const concepto of rubro.children) ids.add(concepto.id);
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
    () => (data ? sortPivotRows(data.rows, sortCol, sortDir) : []),
    [data, sortCol, sortDir]
  );

  const flatRows = useMemo(
    () => flattenRows({ rows: sortedRows, columnTotals: data?.columnTotals ?? {}, grandTotal: data?.grandTotal ?? 0 }, expanded, 3),
    [sortedRows, expanded, data]
  );

  const rubroIds = useMemo(() => new Set(sortedRows.map(r => r.id)), [sortedRows]);

  const collapseConceptos = useCallback((e: React.MouseEvent) => {
    if (navigator.maxTouchPoints > 0) return;
    e.preventDefault();
    setExpanded(prev => new Set([...prev].filter(id => rubroIds.has(id))));
  }, [rubroIds, setExpanded]);

  return {
    expanded, toggleRow, collapseAll, collapseConceptos,
    sortedRows, flatRows, isEmpty: flatRows.length === 0,
    detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  };
}
