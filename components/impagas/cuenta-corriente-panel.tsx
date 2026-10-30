"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fmtComprobante, fmtFecha, fmtPesos, saldo, sumaSaldos, type ComprobanteImpago, type PagoDet,
} from "@/lib/impagas/clasificar";

interface Props {
  comprobantes: ComprobanteImpago[];
  resaltado: string;
  pdvLabel: string;
  onClose: () => void;
  onVerPago?: (p: PagoDet) => void; // abre la OP de MaxiRest
  onVerCompleta?: () => void;        // cuenta corriente completa (pagas incluidas)
  // Pagar (Diego 30/10/2026: "¿y si la quiero pagar?"): abre la cuenta corriente con esas facturas
  // tildadas y el pago listo para confirmar.
  onPagar?: (comprobantes: ComprobanteImpago[]) => void;
}

// Cuenta corriente del proveedor (lectura): sus comprobantes con saldo en el PDV
// y los pagos que el informe 80 les aplicó. Las facturas pagadas completas se
// suman cuando se arme la cuenta corriente completa.
export function CuentaCorrientePanel({ comprobantes, resaltado, pdvLabel, onClose, onVerPago, onVerCompleta, onPagar }: Props) {
  const lista = [...comprobantes].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const proveedor = lista[0]?.proveedor ?? "";
  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/10" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full sm:w-[460px] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 shadow-xl flex flex-col"
      >
        <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700">
          <div className="font-semibold">Cuenta corriente · {proveedor}</div>
          {onVerCompleta && (
            <button type="button" onClick={onVerCompleta} className="ml-auto mr-3 text-xs text-sky-700 dark:text-sky-400 hover:underline">
              Ver completa ›
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Cerrar cuenta corriente" className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground border-b border-zinc-100 dark:border-zinc-800">
          <div>Saldo pendiente<div className="text-sm font-semibold text-foreground tabular-nums">{fmtPesos(sumaSaldos(lista))}</div></div>
          <div>Comprobantes con saldo<div className="text-sm font-semibold text-foreground">{lista.length}</div></div>
          <div>PDV<div className="text-sm font-semibold text-foreground">{pdvLabel}</div></div>
        </div>
        {onPagar && lista.length > 0 && (
          <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 flex gap-2">
            {lista.some((f) => f.id === resaltado) && (
              <button type="button" onClick={() => onPagar(lista.filter((f) => f.id === resaltado))}
                className="h-8 rounded-lg bg-zinc-900 px-3 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900">
                Pagar esta · {fmtPesos(saldo(lista.find((f) => f.id === resaltado)!))}
              </button>
            )}
            {lista.length > 1 && (
              <button type="button" onClick={() => onPagar(lista)}
                className="h-8 rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 text-xs font-semibold">
                Pagar todas · {fmtPesos(sumaSaldos(lista))}
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {lista.map((f) => {
            const parcial = f.pagado !== 0;
            return (
              <div
                key={f.id}
                className={cn(
                  "px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 text-sm",
                  f.id === resaltado && "bg-sky-50 dark:bg-sky-950/40"
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    parcial ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                  )}>
                    {parcial ? "PARCIAL" : "IMPAGA"}
                  </span>
                  <span className="font-semibold tabular-nums">{fmtComprobante(f.comprobante)}</span>
                  <span className="text-muted-foreground">{fmtFecha(f.fecha)}</span>
                  <span className="ml-auto tabular-nums text-xs">
                    {fmtPesos(f.total)} · saldo <b>{fmtPesos(saldo(f))}</b>
                  </span>
                  {onPagar && (
                    <button type="button" onClick={() => onPagar([f])} className="text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline">
                      Pagar ›
                    </button>
                  )}
                </div>
                {f.pagos.length > 0
                  ? f.pagos.map((p, i) => (
                      <div key={i} className="pl-3 text-xs text-muted-foreground tabular-nums">
                        ↳ pago {fmtFecha(p.fecha)} · {fmtPesos(p.importe)}{p.medio ? ` · ${p.medio}` : ""}
                        {p.orden && onVerPago && (
                          <button type="button" onClick={() => onVerPago(p)} className="ml-1.5 text-sky-700 dark:text-sky-400 hover:underline">
                            · OP {p.orden} ›
                          </button>
                        )}
                      </div>
                    ))
                  : <div className="pl-3 text-xs text-muted-foreground">sin pagos registrados</div>}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
