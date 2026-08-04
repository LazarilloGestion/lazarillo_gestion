"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExpandableSet } from "@/hooks/use-expandable-set";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { flattenRows, sortPivotRows } from "@/lib/dashboard/pivot-utils";
import type { DetalleFilter, VentasDetalleFilter } from "@/lib/dashboard/types";

// Orquestación de datos/estado de la pantalla Resultados — separado del render
// (components/dashboard/resultados-pivot-table.tsx) para que ese componente sea
// puramente presentacional.
export function useResultadosData() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion, resultadosConfigVersion,
  } = useDashboard();

  const { expanded, setExpanded, toggle: toggleRow, collapseAll } = useExpandableSet();
  const [detalleFilter, setDetalleFilter] = useState<DetalleFilter | null>(null);
  const [ventasDetalleFilter, setVentasDetalleFilter] = useState<VentasDetalleFilter | null>(null);
  const prevFilterRef = useRef<{ conceptoCodigo?: string; proveedorId?: number; observacionQuery?: string }>({});

  // Operación: mismos totales de Egresos/Ingresos que Compras (misma vista, sin filtrar por visibleEnResultados),
  // reaccionando al buscador de rubro/concepto/proveedor/observación igual que hace Compras.
  const operacion = useOperacionKpis({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, configVersion: rubroConfigVersion, vista: "compras",
  });

  // Societario: pivot filtrado por visibleEnResultados — alimenta "Ganancia" y la tabla de detalle.
  const { data, isLoading, error, ventasData } = useOperacionKpis({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, configVersion: resultadosConfigVersion, vista: "resultados",
  });

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
  }, [data, conceptoCodigo, proveedorId, observacionQuery]);

  function openDetalle(extra: Omit<DetalleFilter, "year" | "localId" | "pdvId">) {
    setDetalleFilter({ year, localId, pdvId, ...extra });
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
  const resultadosEmpty = flatRows.length === 0;

  const collapseConceptos = useCallback((e: React.MouseEvent) => {
    if (navigator.maxTouchPoints > 0) return;
    e.preventDefault();
    setExpanded(prev => new Set([...prev].filter(id => rubroIds.has(id))));
  }, [rubroIds, setExpanded]);

  return {
    year, localId, pdvId, months, sortCol, sortDir, handleSortClick,
    operacion, data, isLoading, error, ventasData,
    sortedRows, flatRows, resultadosEmpty,
    expanded, toggleRow, collapseAll, collapseConceptos,
    detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  };
}
