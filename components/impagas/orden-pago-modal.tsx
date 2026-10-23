"use client";

import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { numeroOP } from "@/lib/impagas/aperturas";
import { fmtComprobante, fmtFecha, fmtPesos } from "@/lib/impagas/clasificar";

// Modal de una orden de pago entre PDV (estilo MaxiRest, simplificado):
// a la izquierda a qué se imputó (con Quitar), a la derecha con qué se pagó.

interface AplicacionOp {
  key: string; fecha: string; comprobante: string | null; proveedor: string; concepto: string; importe: number;
}
interface DetalleOp {
  id: number; fecha: string; importe: number; medio: string; referencia: string | null;
  creadoPor: string | null; creadoEn: string; anulada: boolean; aplicado: number; disponible: number;
  aplicaciones: AplicacionOp[];
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const btn = "h-8 px-3 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm disabled:opacity-40";

function Kpi({ titulo, valor, destacado }: { titulo: string; valor: string; destacado?: boolean }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", destacado ? "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40" : "border-zinc-200 dark:border-zinc-700")}>
      <div className="text-[11px] text-muted-foreground">{titulo}</div>
      <div className="font-semibold tabular-nums">{valor}</div>
    </div>
  );
}

export function OrdenPagoModal({ pagoId, ids, destino, onCambiar, onCerrar, onEditar, onAnular }: {
  pagoId: number;
  ids: number[];             // órdenes vigentes, para Anterior / Siguiente
  destino: string;           // "Ramos Mejía · Bar"
  onCambiar: (id: number) => void;
  onCerrar: () => void;
  onEditar: (id: number) => void;
  onAnular: (id: number) => Promise<void>;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useFetchQuery<DetalleOp>(["impagas-op", pagoId], `/api/impagas/pagos-internos/${pagoId}`, { staleTime: 0 });
  const [ocupado, setOcupado] = useState(false);
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const pos = ids.indexOf(pagoId);

  async function quitar(keys?: string[]) {
    setOcupado(true);
    try {
      const res = await fetch(`/api/impagas/pagos-internos/${pagoId}/desimputar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error ?? "No se pudo quitar la imputación."); return; }
      toast.success(`${numeroOP(pagoId)} · ${fmtPesos(j.quitado)} vuelven a quedar sin imputar`);
    } finally {
      setOcupado(false);
      qc.invalidateQueries({ queryKey: ["impagas"] });
      qc.invalidateQueries({ queryKey: ["impagas-op", pagoId] });
      qc.invalidateQueries({ queryKey: ["impagas-hist"] });
    }
  }

  // Imputaciones agrupadas por mes (más nuevo primero, como en la lista).
  const porMes: [string, AplicacionOp[]][] = [];
  for (const a of data?.aplicaciones ?? []) {
    const m = a.fecha.slice(0, 7);
    const ult = porMes[porMes.length - 1];
    if (ult && ult[0] === m) ult[1].push(a); else porMes.push([m, [a]]);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent showCloseButton className="w-[calc(100vw-2rem)] sm:max-w-[900px] max-h-[86vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-zinc-200 dark:border-zinc-700">
          <DialogTitle className="text-lg">
            <span className="text-sky-700 dark:text-sky-400">{numeroOP(pagoId)}</span> · Pago a {destino}
            {data?.anulada && <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-red-50 text-red-700">anulada</span>}
          </DialogTitle>
          {data && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Cargada el {fmtFecha(data.creadoEn.slice(0, 10))}{data.creadoPor ? ` por ${data.creadoPor}` : ""}
            </div>
          )}
        </div>

        {isLoading || !data ? (
          <div className="py-12 flex justify-center"><Spinner size="lg" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <Kpi titulo="Fecha de pago" valor={fmtFecha(data.fecha)} />
              <Kpi titulo="Total pagado" valor={fmtPesos(data.importe)} />
              <Kpi titulo={`Imputado · ${data.aplicaciones.length} mov.`} valor={fmtPesos(data.aplicado)} />
              <Kpi titulo="Sin imputar" valor={fmtPesos(data.disponible)} destacado={data.disponible > 0.5} />
            </div>

            <div className="grid sm:grid-cols-[1.6fr_1fr] flex-1 min-h-0 overflow-y-auto">
              <div className="px-5 py-3">
                <div className="flex items-center mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Imputado a
                  {data.aplicaciones.length > 0 && !data.anulada && (
                    <button type="button" disabled={ocupado} onClick={() => quitar()} className="ml-auto normal-case tracking-normal font-normal text-xs text-red-600 hover:underline disabled:opacity-40">
                      Quitar todas
                    </button>
                  )}
                </div>
                {data.aplicaciones.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    Sin imputar. Para imputarla, tildá movimientos en la lista y elegí {numeroOP(pagoId)} como medio de pago.
                  </p>
                ) : (
                  <table className="w-full text-[13px]">
                    <tbody>
                      {porMes.map(([mes, l]) => (
                        <Fragment key={mes}>
                          <tr className="bg-zinc-50 dark:bg-zinc-900/60">
                            <td colSpan={3} className="py-1 px-1.5 text-xs font-semibold">{nombreMes(mes)}</td>
                            <td className="py-1 px-1.5 text-right text-xs font-semibold tabular-nums">{fmtPesos(l.reduce((s, a) => s + a.importe, 0))}</td>
                          </tr>
                          {l.map((a) => (
                            <tr key={a.key} className="border-b border-zinc-100 dark:border-zinc-800">
                              <td className="py-1.5 px-1.5 text-muted-foreground tabular-nums whitespace-nowrap">{fmtFecha(a.fecha).slice(0, 5)}</td>
                              <td className="py-1.5 px-1.5">{a.comprobante ? fmtComprobante(a.comprobante) : a.concepto || "—"}</td>
                              <td className="py-1.5 px-1.5 text-muted-foreground">{a.proveedor}{a.comprobante && a.concepto ? ` · ${a.concepto}` : ""}</td>
                              <td className="py-1.5 px-1.5 text-right whitespace-nowrap tabular-nums">
                                {fmtPesos(a.importe)}
                                {!data.anulada && (
                                  <button type="button" disabled={ocupado} onClick={() => quitar([a.key])} title="Quitar esta imputación"
                                    className="ml-2 rounded border border-zinc-200 dark:border-zinc-700 px-1.5 py-0.5 text-[11px] text-red-600 hover:border-red-300 disabled:opacity-40">
                                    Quitar
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="px-5 py-3 border-t sm:border-t-0 sm:border-l border-zinc-200 dark:border-zinc-700">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Valores entregados</div>
                <table className="w-full text-[13px]">
                  <tbody>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5">{data.medio}{data.referencia && <div className="text-[11px] text-muted-foreground font-mono">ID {data.referencia}</div>}</td>
                      <td className="py-1.5 text-muted-foreground tabular-nums">{fmtFecha(data.fecha)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtPesos(data.importe)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/60">
          <button type="button" className={btn} disabled={pos <= 0} onClick={() => onCambiar(ids[pos - 1])}>‹ Anterior</button>
          <button type="button" className={btn} disabled={pos < 0 || pos >= ids.length - 1} onClick={() => onCambiar(ids[pos + 1])}>Siguiente ›</button>
          <span className="ml-auto" />
          {data && !data.anulada && (confirmarAnular ? (
            <span className="inline-flex items-center gap-2 text-sm">
              <span className="text-red-600">¿Anular {numeroOP(pagoId)}? Sus imputaciones se quitan.</span>
              <button type="button" className={cn(btn, "text-red-600")} disabled={ocupado}
                onClick={async () => { setOcupado(true); await onAnular(pagoId); setOcupado(false); onCerrar(); }}>Sí, anular</button>
              <button type="button" className={btn} onClick={() => setConfirmarAnular(false)}>No</button>
            </span>
          ) : (
            <>
              <button type="button" className={btn} onClick={() => onEditar(pagoId)}>Editar</button>
              <button type="button" className={cn(btn, "text-red-600")} onClick={() => setConfirmarAnular(true)}>Anular orden</button>
            </>
          ))}
          <button type="button" className="h-8 px-3 rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-sm" onClick={onCerrar}>Cerrar</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Historial de órdenes de pago entre dos PDV ─────────────────────────────
interface EventoOp {
  id: number; pagoId: number; tipo: string; detalle: string | null; importe: number | null;
  usuario: string | null; cuando: string; anulada: boolean;
}
const TIPO: Record<string, { label: string; cls: string }> = {
  creada: { label: "Creada", cls: "bg-sky-50 text-sky-700" },
  editada: { label: "Editada", cls: "bg-zinc-100 text-zinc-600" },
  imputada: { label: "Imputada", cls: "bg-emerald-50 text-emerald-700" },
  desimputada: { label: "Imputación quitada", cls: "bg-amber-50 text-amber-700" },
  anulada: { label: "Anulada", cls: "bg-red-50 text-red-700" },
};

export function HistorialPagosModal({ pdvDestinoId, pdvOrigenId, origen, onVerOp, onCerrar }: {
  pdvDestinoId: number; pdvOrigenId: number; origen: string;
  onVerOp: (id: number) => void;
  onCerrar: () => void;
}) {
  const { data, isLoading } = useFetchQuery<{ eventos: EventoOp[] }>(
    ["impagas-hist", pdvDestinoId, pdvOrigenId],
    `/api/impagas/pagos-internos/historial?pdvDestinoId=${pdvDestinoId}&pdvOrigenId=${pdvOrigenId}`,
    { staleTime: 0 }
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent showCloseButton className="w-[calc(100vw-2rem)] sm:max-w-[900px] max-h-[86vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-zinc-200 dark:border-zinc-700">
          <DialogTitle className="text-lg">Historial de órdenes de pago · {origen}</DialogTitle>
          <div className="text-xs text-muted-foreground mt-0.5">Nada se borra: lo anulado queda acá. Tocá una orden para verla.</div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <div className="py-10 flex justify-center"><Spinner size="lg" /></div>
          ) : !data?.eventos.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay movimientos.</p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {data.eventos.map((e) => {
                  const t = TIPO[e.tipo] ?? { label: e.tipo, cls: "bg-zinc-100 text-zinc-600" };
                  return (
                    <tr key={e.id} className={cn("border-b border-zinc-100 dark:border-zinc-800", !e.anulada && "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50")}
                      onClick={() => { if (!e.anulada) onVerOp(e.pagoId); }}>
                      <td className="py-2 pr-3 text-muted-foreground tabular-nums whitespace-nowrap">{e.cuando}</td>
                      <td className="py-2 pr-3 whitespace-nowrap"><span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", t.cls)}>{t.label}</span></td>
                      <td className={cn("py-2 pr-3", e.anulada && "line-through text-muted-foreground")}>
                        <b className={e.anulada ? "" : "text-sky-700 dark:text-sky-400"}>{numeroOP(e.pagoId)}</b>
                        {e.detalle ? ` · ${e.detalle}` : ""}
                        {e.usuario && <span className="text-[11px] text-muted-foreground no-underline"> · {e.usuario}</span>}
                      </td>
                      <td className={cn("py-2 text-right tabular-nums whitespace-nowrap", e.anulada && "line-through text-muted-foreground")}>
                        {e.importe == null ? "" : fmtPesos(e.importe)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
