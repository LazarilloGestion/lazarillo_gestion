"use client";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { usePivotScreenData } from "@/hooks/use-pivot-screen-data";

// Orquestación de datos/estado de la pantalla Resultados — separado del render
// (components/dashboard/resultados-pivot-table.tsx) para que ese componente sea
// puramente presentacional.
export function useResultadosData() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, importeQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion, resultadosConfigVersion,
  } = useDashboard();

  // Operación: mismos totales de Egresos/Ingresos que Compras (misma vista, sin filtrar por visibleEnResultados),
  // reaccionando al buscador de rubro/concepto/proveedor/observación igual que hace Compras.
  const operacion = useOperacionKpis({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, importeQuery,
    months, activeMonths, configVersion: rubroConfigVersion, vista: "compras",
  });

  // Societario: pivot filtrado por visibleEnResultados — alimenta "Ganancia" y la tabla de detalle.
  const { data, isLoading, error, ventasData } = useOperacionKpis({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, importeQuery,
    months, activeMonths, configVersion: resultadosConfigVersion, vista: "resultados",
  });

  const {
    expanded, toggleRow, collapseAll, collapseConceptos,
    sortedRows, flatRows, isEmpty: resultadosEmpty,
    detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  } = usePivotScreenData({
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery, importeQuery,
    rubroCodigo, activeMonths,
  });

  return {
    year, localId, pdvId, months, sortCol, sortDir, handleSortClick,
    operacion, data, isLoading, error, ventasData,
    sortedRows, flatRows, resultadosEmpty,
    expanded, toggleRow, collapseAll, collapseConceptos,
    detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  };
}
