"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { notify } from "@/lib/toast";
import { cn, fmtARS } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { parseMontoARS } from "@/lib/dashboard/resultados-calc";
import { buildFlujoCajaUrl } from "@/lib/dashboard/params";
import { useDiferenciaCajaAcumulada } from "@/hooks/use-diferencia-caja-acumulada";
import { cardCellClasses } from "@/lib/dashboard/card-row-classes";
import { EditActionButtons, EditTriggerButton, toEditString } from "./edit-row-controls";
import { SectionDivider } from "./section-divider";
import { StickyCardCell } from "./sticky-card-cell";
import { Wallet } from "lucide-react";

interface FlujoCajaResponse {
  anio: number;
  meses: Record<number, number | null>;
}

const VALUE_TD = "text-right px-3 py-1.5 tabular-nums whitespace-nowrap";
const TOTAL_TD = "text-right px-4 py-1.5 font-semibold tabular-nums whitespace-nowrap";

// Celda de monto genérica: pinta gris si `gray`, rojo/verde según signo, y muestra `text`.
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
    <td title={title} className={cn(base, className, gray ? "text-muted-foreground/40" : negative ? "text-[#D64545]" : "text-[#159457]")}>
      {text}
    </td>
  );
}

interface CajaRowsProps {
  year: number;
  localId?: number;
  pdvId?: number;
  months: number[];
  isEmpty: boolean;
}

export function CajaRows({ year, localId, pdvId, months, isEmpty }: CajaRowsProps) {
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
      <SectionDivider label="Caja" icon={Wallet} colSpan={colSpan} topOfCard />

      <tr className="group">
        <StickyCardCell position="middle" className="px-4 py-1.5 whitespace-nowrap" title={canEditFlujoCaja ? undefined : "Seleccioná un local para cargar Disponible en caja — acá se muestra la suma de todos"}>
          Disponible en caja
        </StickyCardCell>
        {months.map((mes) => {
          const isEditing = editingMonth === mes && canEditFlujoCaja;
          const value = flujoCajaPorMes[mes];
          return (
            <td key={mes} className={cn(VALUE_TD, cardCellClasses("middle", "mid"))}>
              {isEditing ? (
                <div className="flex items-center justify-end gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    aria-label={`Disponible en caja ${MONTHS[mes - 1]}`}
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    className="h-6 w-20 rounded border border-input bg-background px-1 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <EditActionButtons onSave={() => handleSaveFlujoCaja(mes)} onCancel={() => setEditingMonth(null)} saving={saving} />
                </div>
              ) : (
                <div className="flex items-center justify-end gap-1">
                  <span className={cn(value == null && "text-muted-foreground/40")}>
                    {flujoCajaLoading ? "…" : value != null ? fmtARS(value) : "—"}
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
        <td className={cn(TOTAL_TD, cardCellClasses("middle", "mid"))}>{flujoCajaTotal ? fmtARS(flujoCajaTotal) : "—"}</td>
        <td className={cardCellClasses("middle", "right")} />
      </tr>

      <tr className={cn(isEmpty && "opacity-60")} title={isEmpty ? "Incluye $0 de Ganancia: no hay conceptos configurados en Resultados" : undefined}>
        <StickyCardCell position="last" bg="bg-muted" className="px-4 py-1.5 whitespace-nowrap font-bold" title="Saldo de caja acumulado mes a mes, arrastrando el cierre de años anteriores">
          Diferencia de caja
        </StickyCardCell>
        {months.map((mes) => {
          const acumulado = acumuladoPorMes[mes];
          const noData = diferenciaLoading || acumulado == null;
          return (
            <ValueCell
              key={mes}
              base={VALUE_TD}
              className={cn("bg-muted", cardCellClasses("last", "mid"))}
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
              className={cn("bg-muted font-bold", cardCellClasses("last", "mid"))}
              title="Saldo acumulado al último mes visible (no es una sumatoria de la fila)"
              text={diferenciaLoading ? "…" : noData ? "—" : fmtARS(total)}
              negative={!noData && total! < 0}
              gray={noData}
            />
          );
        })()}
        <td className={cn("bg-muted", cardCellClasses("last", "right"))} />
      </tr>
    </>
  );
}
