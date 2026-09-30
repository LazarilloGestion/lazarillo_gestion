"use client";
import { useState } from "react";

// Separada de usePctMode para poder testearla directo con Vitest — no hay
// infraestructura de test de hooks de React en este proyecto.
export function computePctLabel(
  rowTotal: number,
  denominator: number,
  isLoadingIngresos: boolean
): string {
  if (isLoadingIngresos) return "…";
  return denominator > 0 ? `${((rowTotal / denominator) * 100).toFixed(1)}%` : "—";
}

// Reemplaza el useState<"ingresos"|"egresos"> + pctDenominator + fmtPct
// duplicados byte a byte en pivot-table-por-concepto.tsx y
// pivot-table-por-proveedor.tsx.
export function usePctMode(
  grandTotal: number,
  ingresosTotal: number | undefined,
  ventasLoading: boolean
) {
  const [pctMode, setPctMode] = useState<"ingresos" | "egresos">("ingresos");
  const pctDenominator = pctMode === "ingresos" ? (ingresosTotal ?? 0) : grandTotal;
  const fmtPct = (rowTotal: number) =>
    computePctLabel(rowTotal, pctDenominator, pctMode === "ingresos" && ventasLoading);
  const togglePctMode = () => setPctMode((m) => (m === "ingresos" ? "egresos" : "ingresos"));
  return { pctMode, togglePctMode, fmtPct };
}
