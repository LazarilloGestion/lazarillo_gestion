"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { notify } from "@/lib/toast";
import { cn, fmtARS } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { EditActionButtons, EditTriggerButton } from "./edit-row-controls";

interface FlujoCajaResponse {
  anio: number;
  meses: Record<number, number | null>;
}

function buildFlujoCajaUrl(year: number, localId?: number, pdvId?: number): string {
  const sp = new URLSearchParams({ anio: String(year) });
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("puntoDeVentaId", String(pdvId));
  return `/api/dashboard/flujo-caja?${sp.toString()}`;
}

// Mismos anchos mínimos que usa la tabla de detalle (min-w-[240px]/[90px]/[110px] en
// resultados-pivot-table.tsx) para que la barra sticky y las tarjetas alineen con ella.
export function useGridColumns(monthsCount: number): string {
  return useMemo(
    () => `minmax(240px, 1.6fr) repeat(${monthsCount}, minmax(90px, 1fr)) minmax(110px, 0.9fr)`,
    [monthsCount]
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 text-sm font-medium text-muted-foreground">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

interface RowProps {
  label: string;
  gridColumns: string;
  cells: React.ReactNode[];
  total: React.ReactNode;
  labelClassName?: string;
  cellClassName?: string;
  totalClassName?: string;
  rowClassName?: string;
}

function Row({
  label, gridColumns, cells, total,
  labelClassName, cellClassName, totalClassName, rowClassName,
}: RowProps) {
  return (
    <div className={cn("grid items-center", rowClassName)} style={{ gridTemplateColumns: gridColumns }}>
      <div className={cn("px-4 py-2 text-sm whitespace-nowrap", labelClassName)}>
        {label}
      </div>
      {cells.map((c, i) => (
        <div key={i} className={cn("px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap", cellClassName)}>
          {c}
        </div>
      ))}
      <div className={cn("px-4 py-2 text-right text-sm font-semibold tabular-nums whitespace-nowrap", totalClassName)}>
        {total}
      </div>
    </div>
  );
}

interface ResultadosSummaryCardsProps {
  year: number;
  localId?: number;
  pdvId?: number;
  months: number[];
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  ingresosTotal?: number;
  egresosTotal: number;
  movSocietariosPorMes: Record<number, number>;
  movSocietariosTotal: number;
}

export function ResultadosSummaryCards({
  year, localId, pdvId, months,
  ingresosPorMes, egresosPorMes, ingresosTotal, egresosTotal,
  movSocietariosPorMes, movSocietariosTotal,
}: ResultadosSummaryCardsProps) {
  const gridColumns = useGridColumns(months.length);
  const queryClient = useQueryClient();
  const flujoCajaKey = ["flujo-caja", year, localId, pdvId];
  const { data: flujoCajaData, isLoading: flujoCajaLoading } = useFetchQuery<FlujoCajaResponse>(flujoCajaKey, buildFlujoCajaUrl(year, localId, pdvId));

  const [editingMonth, setEditingMonth] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [saving, setSaving] = useState(false);

  const flujoCajaPorMes = flujoCajaData?.meses ?? {};
  const flujoCajaTotal = months.reduce((acc, mes) => acc + (flujoCajaPorMes[mes] ?? 0), 0);

  async function handleSaveFlujoCaja(mes: number) {
    const monto = draftValue === "" ? 0 : parseFloat(draftValue);
    if (Number.isNaN(monto)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/dashboard/flujo-caja", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localId, puntoDeVentaId: pdvId, anio: year, mes, monto }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      await queryClient.invalidateQueries({ queryKey: flujoCajaKey });
      notify.registroActualizado();
      setEditingMonth(null);
    } catch {
      notify.errorGuardar();
    } finally {
      setSaving(false);
    }
  }

  function pctLabel(numerador: number, denominador: number): string {
    return denominador > 0 ? `${((numerador / denominador) * 100).toFixed(1)}%` : "—";
  }

  return (
    <div className="flex flex-col gap-3">
      <SummaryCard title="Societario">
        <Row
          gridColumns={gridColumns}
          label="Movimientos societarios"
          cells={months.map((mes) => fmtARS(movSocietariosPorMes[mes]))}
          total={fmtARS(movSocietariosTotal)}
        />
        <Row
          gridColumns={gridColumns}
          label="% Rentabilidad"
          cells={months.map((mes) => {
            const num = movSocietariosPorMes[mes] ?? 0;
            return <span key={mes} className={cn(num > 0 && "text-success")}>{pctLabel(num, ingresosPorMes[mes] ?? 0)}</span>;
          })}
          total={<span className={cn(movSocietariosTotal > 0 && "text-success")}>{pctLabel(movSocietariosTotal, ingresosTotal ?? 0)}</span>}
          labelClassName="pb-2.5"
          cellClassName="pb-2.5"
          totalClassName="pb-2.5"
        />
      </SummaryCard>

      <SummaryCard title="Caja">
        <Row
          gridColumns={gridColumns}
          label="Flujo de caja"
          cells={months.map((mes) => {
            const isEditing = editingMonth === mes;
            const value = flujoCajaPorMes[mes];
            if (isEditing) {
              return (
                <div key={mes} className="flex items-center justify-end gap-1">
                  <input
                    type="number"
                    step="0.01"
                    autoFocus
                    aria-label={`Flujo de caja ${MONTHS[mes - 1]}`}
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    className="h-6 w-20 rounded border border-input bg-background px-1 text-right text-xs tabular-nums"
                  />
                  <EditActionButtons onSave={() => handleSaveFlujoCaja(mes)} onCancel={() => setEditingMonth(null)} saving={saving} />
                </div>
              );
            }
            return (
              <div key={mes} className="flex items-center justify-end gap-1">
                <span className={cn(value == null && "text-muted-foreground/40")}>
                  {flujoCajaLoading ? "…" : value != null ? fmtARS(value) : "—"}
                </span>
                <EditTriggerButton
                  onClick={() => { setEditingMonth(mes); setDraftValue(value != null ? String(value) : ""); }}
                />
              </div>
            );
          })}
          total={fmtARS(flujoCajaTotal)}
          rowClassName="group"
        />
        <Row
          gridColumns={gridColumns}
          label="Diferencia de caja"
          cells={months.map((mes) => {
            const resultadoOp = (ingresosPorMes[mes] ?? 0) - (egresosPorMes[mes] ?? 0);
            const diferencia = resultadoOp - (movSocietariosPorMes[mes] ?? 0) - (flujoCajaPorMes[mes] ?? 0);
            return <span key={mes} className={cn(diferencia < 0 && "text-destructive")}>{fmtARS(diferencia || undefined)}</span>;
          })}
          total={(() => {
            const resultadoOpTotal = (ingresosTotal ?? 0) - egresosTotal;
            const diferenciaTotal = resultadoOpTotal - movSocietariosTotal - flujoCajaTotal;
            return <span className={cn(diferenciaTotal < 0 && "text-destructive")}>{fmtARS(diferenciaTotal || undefined)}</span>;
          })()}
          labelClassName="font-semibold pb-2.5"
          totalClassName="font-bold pb-2.5"
          cellClassName="pb-2.5"
        />
      </SummaryCard>
    </div>
  );
}
