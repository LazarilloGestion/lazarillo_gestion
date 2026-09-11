"use client";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { PivotTableByConcepto } from "./pivot-table-por-concepto";
import { PivotTableByProveedor } from "./pivot-table-por-proveedor";

export function PivotTable() {
  const { agrupacionCompras } = useDashboard();
  return agrupacionCompras === "proveedor" ? <PivotTableByProveedor /> : <PivotTableByConcepto />;
}
