"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { notify } from "@/lib/toast";
import { cn, fmtARS } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { parseMontoARS, RESULT_COLORS } from "@/lib/dashboard/resultados-calc";
import { buildFlujoCajaUrl } from "@/lib/dashboard/params";
import { useDiferenciaCaja } from "@/hooks/use-diferencia-caja";
import { cardCellClasses } from "@/lib/dashboard/card-row-classes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EditActionButtons, EditTriggerButton, toEditString } from "./edit-row-controls";
import { SectionDivider } from "./section-divider";
import { StickyCardCell } from "./sticky-card-cell";
import { Wallet, Info } from "lucide-react";

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
    <td
      title={title}
      className={cn(base, className)}
      style={{ color: gray ? RESULT_COLORS.noData : negative ? RESULT_COLORS.negative : RESULT_COLORS.positive }}
    >
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
  const { diferenciaPorMes, isLoading: diferenciaLoading } = useDiferenciaCaja({ year, localId, pdvId });

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
        <StickyCardCell position="last" bg="bg-muted" className="px-4 py-1.5 whitespace-nowrap font-bold" title="Variación del disponible en caja del mes menos el resultado societario del mes (no acumulado)">
          <span className="inline-flex items-center gap-1">
            Diferencia de caja
            <Popover>
              <PopoverTrigger
                className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                aria-label="Ver fórmula de Diferencia de caja"
              >
                <Info className="w-3.5 h-3.5" />
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4 text-xs leading-relaxed text-muted-foreground font-normal">
                <p className="text-[13px] font-semibold text-foreground leading-snug">
                  Diferencia de caja = variación de la caja − (Resultado OP − Ganancia)
                </p>
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-[14px_1fr] gap-x-2 gap-y-2.5">
                  <span className="h-5 flex items-center justify-center" aria-hidden>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: RESULT_COLORS.negative }} />
                  </span>
                  <span><span className="font-medium text-foreground/80">Negativo (falta):</span> gastos que salieron de la caja sin cargar.</span>

                  <span className="h-5 flex items-center justify-center" aria-hidden>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: RESULT_COLORS.positive }} />
                  </span>
                  <span><span className="font-medium text-foreground/80">Positivo (sobra):</span> gastos cargados que no salieron de la caja (deuda).</span>

                  <span className="h-5 flex items-center justify-center font-semibold" style={{ color: RESULT_COLORS.noData }} aria-hidden>—</span>
                  <span><span className="font-medium text-foreground/80">Sin dato:</span> mes de apertura o sin arqueo cargado.</span>
                </div>
              </PopoverContent>
            </Popover>
          </span>
        </StickyCardCell>
        {months.map((mes) => {
          const diferencia = diferenciaPorMes[mes];
          const noData = diferenciaLoading || diferencia == null;
          return (
            <ValueCell
              key={mes}
              base={VALUE_TD}
              className={cn("bg-muted", cardCellClasses("last", "mid"))}
              text={diferenciaLoading ? "…" : noData ? "—" : fmtARS(diferencia)}
              negative={!noData && diferencia! < 0}
              gray={noData}
            />
          );
        })}
        {(() => {
          const valores = months.map((mes) => diferenciaPorMes[mes]).filter((v): v is number => v != null);
          const total = valores.length > 0 ? valores.reduce((acc, v) => acc + v, 0) : null;
          const noData = diferenciaLoading || total == null;
          return (
            <ValueCell
              base={TOTAL_TD}
              className={cn("bg-muted font-bold", cardCellClasses("last", "mid"))}
              title="Suma de los meses visibles con arqueo cargado"
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
