"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { fmtComprobante, fmtFecha, fmtPesos } from "@/lib/impagas/clasificar";
import { Kpi, btn } from "./orden-pago-modal";

// Pago registrado en MaxiRest (informe 80), solo lectura: se edita en MaxiRest
// y la próxima importación lo trae. Mismo formato que el modal de OP del panel.

interface DetalleMx {
  orden: string; fecha: string; medios: string[]; importe: number;
  comprobantes: { comprobante: string | null; fecha: string | null; proveedor: string; concepto: string; total: number | null; importe: number }[];
  fechas: { fecha: string; importe: number; comprobantes: number }[];
}

export function OpMaxirestModal({ pdvId, orden, fecha, onCambiar, onCerrar }: {
  pdvId: number; orden: string; fecha: string;
  onCambiar: (fecha: string) => void;
  onCerrar: () => void;
}) {
  const url = `/api/impagas/op-maxirest?pdvId=${pdvId}&orden=${encodeURIComponent(orden)}&fecha=${fecha}`;
  const { data, isLoading, isError } = useFetchQuery<DetalleMx>(["impagas-op-mx", pdvId, orden, fecha], url);
  const fechas = data?.fechas ?? [];
  const i = fechas.findIndex((f) => f.fecha === fecha);
  const ant = i > 0 ? fechas[i - 1].fecha : null;
  const sig = i >= 0 && i < fechas.length - 1 ? fechas[i + 1].fecha : null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent showCloseButton className="w-[calc(100vw-2rem)] sm:max-w-[900px] h-[min(86vh,720px)] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <DialogTitle className="text-lg">
            <span className="text-sky-700 dark:text-sky-400">OP {orden}</span> · pago del {fmtFecha(fecha)}
            <span className="ml-2 align-middle rounded px-1.5 py-0.5 text-[10px] font-semibold bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">MaxiRest · solo lectura</span>
          </DialogTitle>
          <div className="text-xs text-muted-foreground mt-0.5 h-4">
            Viene del informe 80. Para cambiarla, editala en MaxiRest: la próxima importación la actualiza.
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
        ) : isError || !data ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No se encontró ese pago.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
              <Kpi titulo="Fecha de pago" valor={fmtFecha(data.fecha)} />
              <Kpi titulo="Total pagado" valor={fmtPesos(data.importe)} />
              <Kpi titulo="Comprobantes" valor={String(new Set(data.comprobantes.map((c) => c.comprobante)).size)} />
              <Kpi titulo="Medio" valor={data.medios.join(" · ") || "—"} />
            </div>
            <div className="grid sm:grid-cols-[1.6fr_1fr] content-start flex-1 min-h-0 overflow-y-auto">
              <div className="px-5 py-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pagó</div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground">
                      <th className="py-1 px-1.5 text-left font-normal">Comprobante</th>
                      <th className="py-1 px-1.5 text-left font-normal">Concepto</th>
                      <th className="py-1 px-1.5 text-right font-normal">Total</th>
                      <th className="py-1 px-1.5 text-right font-normal">Pagado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.comprobantes.map((c, k) => (
                      <tr key={k} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5 px-1.5 whitespace-nowrap">
                          <span className="tabular-nums">{c.comprobante ? fmtComprobante(c.comprobante) : "—"}</span>
                          {c.fecha && <span className="text-muted-foreground"> · {fmtFecha(c.fecha)}</span>}
                        </td>
                        <td className="py-1.5 px-1.5 text-muted-foreground">{c.proveedor}{c.concepto ? ` · ${c.concepto}` : ""}</td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums text-muted-foreground whitespace-nowrap">{c.total == null ? "" : fmtPesos(c.total)}</td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums whitespace-nowrap">
                          {fmtPesos(c.importe)}
                          {c.total != null && c.total - c.importe > 1 && (
                            <span className="ml-1.5 rounded px-1 py-0.5 text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">parcial</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t sm:border-t-0 sm:border-l border-zinc-200 dark:border-zinc-700">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Pagos con la orden {orden} · {fechas.length}
                </div>
                <table className="w-full text-[13px]">
                  <tbody>
                    {fechas.map((f) => (
                      <tr key={f.fecha} onClick={() => f.fecha !== fecha && onCambiar(f.fecha)}
                        className={f.fecha === fecha ? "bg-sky-50 dark:bg-sky-950/40 font-semibold" : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}>
                        <td className="py-1.5 px-1.5 tabular-nums">{fmtFecha(f.fecha)}</td>
                        <td className="py-1.5 px-1.5 text-muted-foreground">{f.comprobantes} cpb.</td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums">{fmtPesos(f.importe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-muted-foreground">En MaxiRest el número de orden se repite en los débitos de cada mes; cada fecha es un pago.</p>
              </div>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/60 shrink-0">
          <button type="button" className={btn} disabled={!ant} onClick={() => ant && onCambiar(ant)}>‹ Anterior</button>
          <button type="button" className={btn} disabled={!sig} onClick={() => sig && onCambiar(sig)}>Siguiente ›</button>
          <span className="ml-auto" />
          <button type="button" className="h-8 px-3 rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-sm" onClick={onCerrar}>Cerrar</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
