"use client";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { PivotTableByConcepto } from "./pivot-table-por-concepto";
import { PivotTableByProveedor } from "./pivot-table-por-proveedor";

export function PivotTable() {
  const { agrupacionCompras } = useDashboard();
  if (agrupacionCompras === "proveedor") return <PivotTableByProveedor />;
  // Vista Insumos: mismo árbol que Concepto, con insumos (o el concepto si no tiene detalle) en el 2do nivel.
  return agrupacionCompras === "insumo" ? <PivotTableByConcepto key="insumo" agrupacion="insumo" /> : <PivotTableByConcepto />;
}
