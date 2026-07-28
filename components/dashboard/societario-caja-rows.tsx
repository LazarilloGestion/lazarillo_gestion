"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { notify } from "@/lib/toast";
import { cn, fmtARS } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { EditActionButtons, EditTriggerButton } from "./edit-row-controls";
import { Users, Wallet, type LucideIcon } from "lucide-react";

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

// Mismas clases que KpiBlock — filas sueltas de <tr>, sin tabla ni wrapper propio,
// para insertarse en el <thead> de la única tabla de Resultados.
const LABEL_TD = "sticky left-0 z-10 bg-background px-4 py-1.5 text-sm whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]";
const VALUE_TD = "text-right px-3 py-1.5 text-xs tabular-nums whitespace-nowrap";
const TOTAL_TD = "text-right px-4 py-1.5 text-sm font-semibold tabular-nums whitespace-nowrap";

interface SocietarioCajaRowsProps {
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
  isEmpty: boolean;
}

function SectionDivider({ label, icon: Icon, colSpan }: { label: string; icon: LucideIcon; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-muted/30 py-1.5">
        <div className="sticky left-0 z-10 flex w-fit items-center gap-1.5 bg-muted px-4 text-xs font-medium text-muted-foreground shadow-[1px_0_0_0_hsl(var(--border))]">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </div>
      </td>
    </tr>
  );
}

export function SocietarioCajaRows({
  year, localId, pdvId, months,
  ingresosPorMes, egresosPorMes, ingresosTotal, egresosTotal,
  movSocietariosPorMes, movSocietariosTotal, isEmpty,
}: SocietarioCajaRowsProps) {
  const queryClient = useQueryClient();
  const flujoCajaKey = ["flujo-caja", year, localId, pdvId];
  const { data: flujoCajaData, isLoading: flujoCajaLoading } = useFetchQuery<FlujoCajaResponse>(flujoCajaKey, buildFlujoCajaUrl(year, localId, pdvId));

  const [editingMonth, setEditingMonth] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [saving, setSaving] = useState(false);

  const flujoCajaPorMes = flujoCajaData?.meses ?? {};
  const flujoCajaTotal = months.reduce((acc, mes) => acc + (flujoCajaPorMes[mes] ?? 0), 0);
  const colSpan = months.length + 3; // label + meses + total + % ing

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
    <>
      <SectionDivider label="Societario" icon={Users} colSpan={colSpan} />

      <tr className="border-b">
        <td className={LABEL_TD}>Movimientos societarios</td>
        {months.map((mes) => {
          const raw = movSocietariosPorMes[mes];
          const showDash = isEmpty || raw == null;
          return (
            <td key={mes} className={cn(VALUE_TD, showDash ? "text-muted-foreground/40" : (raw as number) < 0 && "text-destructive")}>
              {showDash ? "—" : fmtARS(raw)}
            </td>
          );
        })}
        <td className={cn(TOTAL_TD, isEmpty ? "text-muted-foreground/40" : movSocietariosTotal < 0 && "text-destructive")}>
          {isEmpty ? "—" : fmtARS(movSocietariosTotal)}
        </td>
        <td />
      </tr>

      <tr className="border-b-2">
        <td className={LABEL_TD}>% Rentabilidad</td>
        {months.map((mes) => {
          const raw = movSocietariosPorMes[mes];
          const num = raw ?? 0;
          const label = isEmpty || raw == null ? "—" : pctLabel(num, ingresosPorMes[mes] ?? 0);
          const isDash = label === "—";
          return (
            <td key={mes} className={VALUE_TD}>
              <span className={cn(isDash ? "text-muted-foreground/40" : num > 0 ? "text-success" : num < 0 ? "text-destructive" : undefined)}>{label}</span>
            </td>
          );
        })}
        <td className={TOTAL_TD}>
          {(() => {
            const label = isEmpty ? "—" : pctLabel(movSocietariosTotal, ingresosTotal ?? 0);
            const isDash = label === "—";
            return (
              <span className={cn(isDash ? "text-muted-foreground/40" : movSocietariosTotal > 0 ? "text-success" : movSocietariosTotal < 0 ? "text-destructive" : undefined)}>{label}</span>
            );
          })()}
        </td>
        <td />
      </tr>

      <SectionDivider label="Caja" icon={Wallet} colSpan={colSpan} />

      <tr className="border-b group">
        <td className={LABEL_TD}>Flujo de caja</td>
        {months.map((mes) => {
          const isEditing = editingMonth === mes;
          const value = flujoCajaPorMes[mes];
          return (
            <td key={mes} className={VALUE_TD}>
              {isEditing ? (
                <div className="flex items-center justify-end gap-1">
                  <input
                    type="number"
                    step="0.01"
                    autoFocus
                    aria-label={`Flujo de caja ${MONTHS[mes - 1]}`}
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    className="h-6 w-20 rounded border border-input bg-background px-1 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <EditActionButtons onSave={() => handleSaveFlujoCaja(mes)} onCancel={() => setEditingMonth(null)} saving={saving} />
                </div>
              ) : (
                <div className="flex items-center justify-end gap-1">
                  <span className={cn(!value && "text-muted-foreground/40")}>
                    {flujoCajaLoading ? "…" : value ? fmtARS(value) : "—"}
                  </span>
                  <EditTriggerButton
                    onClick={() => { setEditingMonth(mes); setDraftValue(value ? String(value) : ""); }}
                  />
                </div>
              )}
            </td>
          );
        })}
        <td className={TOTAL_TD}>{flujoCajaTotal ? fmtARS(flujoCajaTotal) : "—"}</td>
        <td />
      </tr>

      <tr className={cn("border-b-2", isEmpty && "opacity-60")} title={isEmpty ? "Incluye $0 de movimientos societarios: no hay conceptos configurados en Resultados" : undefined}>
        <td className={cn(LABEL_TD, "bg-muted text-base font-bold")}>Diferencia de caja</td>
        {months.map((mes) => {
          const ingVal = ingresosPorMes[mes];
          const egrVal = egresosPorMes[mes];
          const movVal = movSocietariosPorMes[mes];
          const flujoVal = flujoCajaPorMes[mes];
          const noData = ingVal == null && egrVal == null && movVal == null && flujoVal == null;
          const diferencia = (ingVal ?? 0) - (egrVal ?? 0) - (movVal ?? 0) - (flujoVal ?? 0);
          return (
            <td key={mes} className={cn(VALUE_TD, "bg-muted text-sm")}>
              <span className={cn(noData ? "text-muted-foreground/40" : diferencia < 0 && "text-destructive")}>{fmtARS(diferencia || undefined)}</span>
            </td>
          );
        })}
        <td className={cn(TOTAL_TD, "bg-muted text-base font-bold")}>
          {(() => {
            const resultadoOpTotal = (ingresosTotal ?? 0) - egresosTotal;
            const diferenciaTotal = resultadoOpTotal - movSocietariosTotal - flujoCajaTotal;
            return <span className={cn(diferenciaTotal < 0 && "text-destructive")}>{fmtARS(diferenciaTotal || undefined)}</span>;
          })()}
        </td>
        <td className="bg-muted" />
      </tr>
    </>
  );
}
