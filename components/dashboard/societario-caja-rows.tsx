"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { notify } from "@/lib/toast";
import { cn, fmtARS, fmtARSDecimal } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { parseMontoARS, pctSobreIngresos } from "@/lib/dashboard/resultados-calc";
import { buildFlujoCajaUrl } from "@/lib/dashboard/params";
import { useDiferenciaCajaAcumulada } from "@/hooks/use-diferencia-caja-acumulada";
import { EditActionButtons, EditTriggerButton, toEditString } from "./edit-row-controls";
import { Users, Wallet, type LucideIcon } from "lucide-react";

interface FlujoCajaResponse {
  anio: number;
  meses: Record<number, number | null>;
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
  ingresosTotal?: number;
  gananciaPorMes: Record<number, number>;
  gananciaTotal: number;
  isEmpty: boolean;
}

export function SectionDivider({ label, icon: Icon, colSpan }: { label: string; icon: LucideIcon; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-muted py-1.5">
        <div className="sticky left-0 z-10 flex w-fit items-center gap-1.5 bg-muted px-4 text-xs font-medium text-muted-foreground shadow-[1px_0_0_0_hsl(var(--border))]">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </div>
      </td>
    </tr>
  );
}

// Celda de monto genérica: pinta gris si `gray`, rojo si `negative` (y no gris), y muestra `text`.
// Puramente presentacional — cada fila decide sus propias reglas de "sin dato"/signo/redondeo a 0
// antes de llamarla, para no forzar una única regla de negocio entre filas que hoy difieren sutilmente.
function ValueCell({
  text,
  negative,
  gray,
  base = VALUE_TD,
  className,
  title,
}: {
  text: string;
  negative: boolean;
  gray: boolean;
  base?: string;
  className?: string;
  title?: string;
}) {
  return (
    <td title={title} className={cn(base, className, gray ? "text-muted-foreground/40" : negative && "text-destructive")}>
      {text}
    </td>
  );
}

export function SocietarioCajaRows({
  year, localId, pdvId, months,
  ingresosPorMes, ingresosTotal,
  gananciaPorMes, gananciaTotal, isEmpty,
}: SocietarioCajaRowsProps) {
  const queryClient = useQueryClient();
  const flujoCajaKey = ["flujo-caja", year, localId, pdvId];
  const { data: flujoCajaData, isLoading: flujoCajaLoading } = useFetchQuery<FlujoCajaResponse>(flujoCajaKey, buildFlujoCajaUrl(year, localId, pdvId));
  const { acumuladoPorMes, isLoading: diferenciaLoading } = useDiferenciaCajaAcumulada({ year, localId, pdvId });

  const [editingMonth, setEditingMonth] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [saving, setSaving] = useState(false);

  const flujoCajaPorMes = flujoCajaData?.meses ?? {};
  const flujoCajaTotal = months.reduce((acc, mes) => acc + (flujoCajaPorMes[mes] ?? 0), 0);
  const colSpan = months.length + 3; // label + meses + total + % ing
  // Sin local seleccionado, "todos los locales" es una vista agregada de solo lectura —
  // editar acá guardaría un valor ambiguo (localId null) que se suma al resto sin distinguirse.
  const canEditFlujoCaja = localId != null;

  async function handleSaveFlujoCaja(mes: number) {
    const monto = parseMontoARS(draftValue);
    if (monto === null) return;
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
    } catch (e) {
      console.error(e);
      notify.errorGuardar();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SectionDivider label="Societario" icon={Users} colSpan={colSpan} />

      <tr className="border-b">
        <td className={cn(LABEL_TD, "bg-success-muted text-base font-bold")}>Ganancia</td>
        {months.map((mes) => {
          const raw = gananciaPorMes[mes];
          const gray = isEmpty || raw == null;
          return (
            <ValueCell
              key={mes}
              className="bg-success-muted text-sm font-semibold"
              text={gray ? "—" : fmtARS(raw)}
              negative={(raw ?? 0) < 0}
              gray={gray}
            />
          );
        })}
        <ValueCell
          base={TOTAL_TD}
          className="bg-success-muted text-base font-bold"
          text={isEmpty ? "—" : fmtARS(gananciaTotal)}
          negative={gananciaTotal < 0}
          gray={isEmpty}
        />
        <td className="bg-success-muted" />
      </tr>

      <tr className="border-b-2">
        <td className={LABEL_TD}>% Rentabilidad</td>
        {months.map((mes) => {
          const raw = gananciaPorMes[mes];
          const num = raw ?? 0;
          const label = isEmpty || raw == null ? "—" : pctSobreIngresos(num, ingresosPorMes[mes] ?? 0);
          const isDash = label === "—";
          return (
            <td key={mes} className={VALUE_TD}>
              <span className={cn(isDash ? "text-muted-foreground/40" : num > 0 ? "text-success" : num < 0 ? "text-destructive" : undefined)}>{label}</span>
            </td>
          );
        })}
        <td className={TOTAL_TD}>
          {(() => {
            const label = isEmpty ? "—" : pctSobreIngresos(gananciaTotal, ingresosTotal ?? 0);
            const isDash = label === "—";
            return (
              <span className={cn(isDash ? "text-muted-foreground/40" : gananciaTotal > 0 ? "text-success" : gananciaTotal < 0 ? "text-destructive" : undefined)}>{label}</span>
            );
          })()}
        </td>
        <td />
      </tr>

      <SectionDivider label="Caja" icon={Wallet} colSpan={colSpan} />

      <tr className="border-b group">
        <td className={LABEL_TD} title={canEditFlujoCaja ? undefined : "Seleccioná un local para cargar Flujo de caja — acá se muestra la suma de todos"}>
          Flujo de caja
        </td>
        {months.map((mes) => {
          const isEditing = editingMonth === mes && canEditFlujoCaja;
          const value = flujoCajaPorMes[mes];
          return (
            <td key={mes} className={VALUE_TD}>
              {isEditing ? (
                <div className="flex items-center justify-end gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
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
                  <span className={cn(value == null && "text-muted-foreground/40")}>
                    {flujoCajaLoading ? "…" : value != null ? fmtARSDecimal(value) : "—"}
                  </span>
                  {canEditFlujoCaja && (
                    <EditTriggerButton
                      onClick={() => { setEditingMonth(mes); setDraftValue(toEditString(value)); }}
                    />
                  )}
                </div>
              )}
            </td>
          );
        })}
        <td className={TOTAL_TD}>{flujoCajaTotal ? fmtARSDecimal(flujoCajaTotal) : "—"}</td>
        <td />
      </tr>

      <tr className={cn("border-b-2", isEmpty && "opacity-60")} title={isEmpty ? "Incluye $0 de Ganancia: no hay conceptos configurados en Resultados" : undefined}>
        <td className={cn(LABEL_TD, "bg-muted text-base font-bold")} title="Saldo de caja acumulado mes a mes, arrastrando el cierre de años anteriores">
          Diferencia de caja
        </td>
        {months.map((mes) => {
          const acumulado = acumuladoPorMes[mes];
          const noData = diferenciaLoading || acumulado == null;
          return (
            <ValueCell
              key={mes}
              base={VALUE_TD}
              className="bg-muted text-sm"
              text={diferenciaLoading ? "…" : noData ? "—" : fmtARS(acumulado)}
              negative={!noData && acumulado! < 0}
              gray={noData}
            />
          );
        })}
        {(() => {
          const lastMes = months[months.length - 1];
          const total = acumuladoPorMes[lastMes];
          const noData = diferenciaLoading || total == null;
          return (
            <ValueCell
              base={TOTAL_TD}
              className="bg-muted text-base font-bold"
              title="Saldo acumulado al último mes visible (no es una sumatoria de la fila)"
              text={diferenciaLoading ? "…" : noData ? "—" : fmtARS(total)}
              negative={!noData && total! < 0}
              gray={noData}
            />
          );
        })()}
        <td className="bg-muted" />
      </tr>
    </>
  );
}
