"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fmtComprobante, fmtFecha, fmtPesos, saldo, sumaSaldos, type ComprobanteImpago,
} from "@/lib/impagas/clasificar";

interface Props {
  comprobantes: ComprobanteImpago[];
  resaltado: string;
  pdvLabel: string;
  onClose: () => void;
}

// Cuenta corriente del proveedor (lectura): sus comprobantes con saldo en el PDV
// y los pagos que el informe 80 les aplicó. Las facturas pagadas completas se
// suman cuando se arme la cuenta corriente completa.
export function CuentaCorrientePanel({ comprobantes, resaltado, pdvLabel, onClose }: Props) {
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
          <button type="button" onClick={onClose} aria-label="Cerrar cuenta corriente" className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground border-b border-zinc-100 dark:border-zinc-800">
          <div>Saldo pendiente<div className="text-sm font-semibold text-foreground tabular-nums">{fmtPesos(sumaSaldos(lista))}</div></div>
          <div>Comprobantes con saldo<div className="text-sm font-semibold text-foreground">{lista.length}</div></div>
          <div>PDV<div className="text-sm font-semibold text-foreground">{pdvLabel}</div></div>
        </div>
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
                </div>
                {f.pagos.length > 0
                  ? f.pagos.map((p, i) => (
                      <div key={i} className="pl-3 text-xs text-muted-foreground tabular-nums">
                        ↳ pago {fmtFecha(p.fecha)} · {fmtPesos(p.importe)}{p.medio ? ` · ${p.medio}` : ""}
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
