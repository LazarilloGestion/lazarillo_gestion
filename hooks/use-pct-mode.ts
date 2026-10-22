"use client";
import { useState } from "react";
import { fmtARS } from "@/lib/utils";

export type ModoCelda = "importe" | "pct";

// Celda mensual en modo "% ing" (punto 6 de Pendientes_desarrollo_etapa3):
// peso del valor sobre los ingresos de ESE mes. Sin ingresos del mes (todavía
// cargando o mes sin ventas) → "—", igual que una celda vacía. Puro, testeable.
export function computePctCelda(valor: number | undefined | null, ingresosMes: number | undefined | null): string {
  if (valor == null) return "—";
  if (ingresosMes == null || ingresosMes <= 0) return "—";
  return `${((valor / ingresosMes) * 100).toFixed(1)}%`;
}

// Formateador de celda mensual según el toggle $ / % ing. La columna Total y
// la fila de Ingresos siguen en $ siempre (referencia).
export function makeFmtCelda(
  modo: ModoCelda,
  ingresosPorMes: Record<number, number>,
  ingresosReady: boolean
): (valor: number | undefined | null, mes: number) => string {
  if (modo === "importe") return (valor) => fmtARS(valor);
  return (valor, mes) => (!ingresosReady && valor != null ? "…" : computePctCelda(valor, ingresosPorMes[mes]));
}

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
