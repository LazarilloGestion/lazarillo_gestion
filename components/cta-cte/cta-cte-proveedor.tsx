"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { SearchInput } from "@/components/ui/search-input";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { fmtComprobante, fmtFecha, fmtPesos } from "@/lib/impagas/clasificar";
import {
  CHIP_ESTADO, ETIQUETA_ESTADO, filtrarPorPeriodo, totalesCtaCte, type EstadoPago, type PeriodoCtaCte,
} from "@/lib/cta-cte/estado";
import { OpMaxirestModal } from "@/components/impagas/op-maxirest-modal";

// Cuenta corriente del proveedor en un PDV — SOLO LECTURA (punto 4, Etapa 3).
// Todas sus facturas (pagas incluidas) con el estado y los pagos del informe 80.
// Se usa embebida (Detalle de compras de un registro) o en su propio modal.

interface PagoCtaCte { fecha: string; importe: number; medio: string | null; orden: string | null }
interface FacturaCtaCte {
  comprobante: string; fecha: string; total: number; pagado: number; conceptos: string;
  rowId: string | null; solo80: boolean; estado: EstadoPago | null; pagos: PagoCtaCte[];
}
interface CtaCteResp {
  codPro: string; pdvId: number; proveedor: string; razon: string | null; cuit: string | null;
  pagoAutomatico: boolean; desdeCobertura: string;
  pdvs: { id: number; label: string; facturas: number }[];
  facturas: FacturaCtaCte[];
}

type FiltroEstado = "todas" | "impagas" | "pagas";
const ESTADOS_IMPAGOS: (EstadoPago | null)[] = ["impaga", "parcial"];

const seg = (activo: boolean) => cn(
  "h-7 px-2.5 text-xs rounded-md transition-colors",
  activo ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-muted-foreground hover:text-foreground",
);

function Kpi({ titulo, valor, cls }: { titulo: string; valor: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{titulo}</div>
      <div className={cn("font-semibold tabular-nums", cls)}>{valor}</div>
    </div>
  );
}

export function CtaCteContenido({ pdvId: pdvInicial, codPro, resaltado, titulo, conCerrar }: {
  pdvId: number;
  codPro: string;
  resaltado?: string | null;   // comprobante a destacar
  titulo?: (texto: string) => React.ReactNode; // el modal lo envuelve en DialogTitle
  conCerrar?: boolean;         // deja lugar a la ✕ del modal
}) {
  const [pdvId, setPdvId] = useState(pdvInicial);
  const { data, isLoading, isError } = useFetchQuery<CtaCteResp>(
    ["cta-cte", pdvId, codPro], `/api/cta-cte?pdvId=${pdvId}&codPro=${encodeURIComponent(codPro)}`,
  );
  const [periodo, setPeriodo] = useState<PeriodoCtaCte | null>(null);
  const [filtro, setFiltro] = useState<FiltroEstado>("todas");
  const [q, setQ] = useState("");
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set(resaltado ? [resaltado] : []));
  const [opMx, setOpMx] = useState<{ orden: string; fecha: string } | null>(null);
  const filaResaltada = useRef<HTMLTableRowElement | null>(null);

  // Período inicial: el año de la factura resaltada; si no, el año más nuevo con facturas.
  const periodoEf: PeriodoCtaCte = useMemo(() => {
    if (periodo) return periodo;
    const f = data?.facturas.find((x) => x.comprobante === resaltado) ?? data?.facturas[0];
    const anio = f?.fecha ? Number(f.fecha.slice(0, 4)) : new Date().getFullYear();
    return { modo: "anio", anio };
  }, [periodo, data, resaltado]);

  const delPeriodo = useMemo(() => filtrarPorPeriodo(data?.facturas ?? [], periodoEf), [data, periodoEf]);
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return delPeriodo.filter((f) =>
      (filtro === "todas" || (filtro === "impagas" ? ESTADOS_IMPAGOS.includes(f.estado) : f.estado === "paga" || f.estado === "auto")) &&
      (!t || f.comprobante.toLowerCase().includes(t.replace(/[\s-]/g, "")) || fmtComprobante(f.comprobante).toLowerCase().includes(t) || f.conceptos.toLowerCase().includes(t)));
  }, [delPeriodo, filtro, q]);
  const tot = useMemo(() => totalesCtaCte(delPeriodo), [delPeriodo]);
  // El saldo pendiente es de TODA la cuenta, no del período.
  const saldoTotal = useMemo(() => totalesCtaCte(data?.facturas ?? []), [data]);

  useEffect(() => {
    filaResaltada.current?.scrollIntoView({ block: "center" });
  }, [data]);

  const anios = useMemo(() => [...new Set((data?.facturas ?? []).map((f) => Number(f.fecha.slice(0, 4))).filter(Boolean))].sort(), [data]);
  const moverAnio = (d: number) => setPeriodo({ modo: "anio", anio: periodoEf.anio + d });

  const toggle = (c: string) => setAbiertas((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  const encabezado = data ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {(titulo ?? ((t) => <h3 className="text-base font-semibold">{t}</h3>))(`Cuenta corriente · ${data.proveedor}`)}
      {data.cuit && <span className="text-xs text-muted-foreground">CUIT {data.cuit}</span>}
      {data.pagoAutomatico && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", CHIP_ESTADO.auto)}>pago automático</span>}
      {data.pdvs.length > 1 ? (
        <select value={pdvId} onChange={(e) => { setPdvId(Number(e.target.value)); setPeriodo(null); }}
          className="ml-auto h-7 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 text-xs">
          {data.pdvs.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.facturas}</option>)}
        </select>
      ) : data.pdvs[0] && <span className="ml-auto text-xs text-muted-foreground">{data.pdvs[0].label}</span>}
    </div>
  ) : (titulo ?? ((t) => <h3 className="text-base font-semibold">{t}</h3>))("Cuenta corriente");

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className={cn("px-5 pt-4 pb-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0", conCerrar && "pr-12")}>{encabezado}</div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center py-10"><Spinner size="lg" /></div>
      ) : isError || !data ? (
        <div className="flex-1 flex items-center justify-center py-10 text-sm text-muted-foreground">No se pudo leer la cuenta corriente.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 px-5 py-3 shrink-0">
            <Kpi titulo={`Saldo pendiente · ${saldoTotal.impagas} impaga${saldoTotal.impagas === 1 ? "" : "s"}`} valor={fmtPesos(saldoTotal.saldo)}
              cls={saldoTotal.saldo > 0.5 ? "text-red-600 dark:text-red-400" : undefined} />
            <Kpi titulo={`Facturas · ${periodoEf.modo === "todo" ? "todo" : periodoEf.anio}`} valor={String(delPeriodo.length)} />
            <Kpi titulo="Facturado en el período" valor={fmtPesos(tot.total)} />
            <Kpi titulo="Pagado en el período" valor={fmtPesos(tot.pagado)} />
          </div>

          <div className="flex flex-wrap items-center gap-2 px-5 pb-2 shrink-0">
            <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5">
              <button type="button" aria-label="Año anterior" disabled={periodoEf.modo === "todo" || !anios.length || periodoEf.anio <= anios[0]}
                onClick={() => moverAnio(-1)} className="h-7 w-7 inline-flex items-center justify-center rounded-md disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /></button>
              <button type="button" className={seg(periodoEf.modo === "anio")} onClick={() => setPeriodo({ modo: "anio", anio: periodoEf.anio })}>{periodoEf.anio}</button>
              <button type="button" aria-label="Año siguiente" disabled={periodoEf.modo === "todo" || !anios.length || periodoEf.anio >= anios[anios.length - 1]}
                onClick={() => moverAnio(1)} className="h-7 w-7 inline-flex items-center justify-center rounded-md disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
              <button type="button" className={seg(periodoEf.modo === "todo")} onClick={() => setPeriodo({ modo: "todo", anio: periodoEf.anio })}>Todo</button>
            </div>
            <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5">
              {(["todas", "impagas", "pagas"] as FiltroEstado[]).map((f) => (
                <button key={f} type="button" className={seg(filtro === f)} onClick={() => setFiltro(f)}>
                  {f === "todas" ? "Todas" : f === "impagas" ? "Impagas" : "Pagas"}
                </button>
              ))}
            </div>
            <SearchInput value={q} onChange={setQ} placeholder="Comprobante o concepto" className="ml-auto w-56" />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-3">
            {visibles.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin facturas para la selección.</p>
            ) : (
              <table className="w-full text-[13px] table-fixed">
                <thead className="sticky top-0 z-10 bg-white dark:bg-zinc-900">
                  <tr className="border-b border-zinc-200 dark:border-zinc-700 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-2 text-left font-semibold w-[7.5rem]">Estado</th>
                    <th className="py-1.5 px-2 text-left font-semibold w-[10.5rem]">Comprobante</th>
                    <th className="py-1.5 px-2 text-left font-semibold w-[6.5rem]">Fecha</th>
                    <th className="py-1.5 px-2 text-left font-semibold">Concepto</th>
                    <th className="py-1.5 px-2 text-right font-semibold w-[8rem]">Total</th>
                    <th className="py-1.5 px-2 text-right font-semibold w-[8rem]">Pagado</th>
                    <th className="py-1.5 pl-2 text-right font-semibold w-[8rem]">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => {
                    const ab = abiertas.has(f.comprobante);
                    const res = f.comprobante === resaltado;
                    const deuda = ESTADOS_IMPAGOS.includes(f.estado);
                    return (
                      <Fragment key={f.comprobante}>
                        <tr ref={res ? filaResaltada : undefined} onClick={() => toggle(f.comprobante)}
                          className={cn("border-b border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
                            res && "bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-50")}>
                          <td className="py-2 pr-2">
                            {f.estado ? (
                              <span title={f.estado === "sin-datos" ? `El informe 80 de este PDV no cubre antes del ${fmtFecha(data.desdeCobertura)}` : undefined}
                                className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", CHIP_ESTADO[f.estado])}>{ETIQUETA_ESTADO[f.estado]}</span>
                            ) : <span className="text-[11px] text-muted-foreground">—</span>}
                          </td>
                          <td className="py-2 px-2 tabular-nums font-medium whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              {f.pagos.length > 0 && <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", !ab && "-rotate-90")} />}
                              {fmtComprobante(f.comprobante)}
                            </span>
                            {f.solo80 && <span className="ml-1.5 text-[10px] text-muted-foreground" title="El pago está en el informe 80 pero la factura no está en el 14">solo 80</span>}
                          </td>
                          <td className="py-2 px-2 tabular-nums text-muted-foreground">{f.fecha ? fmtFecha(f.fecha) : "—"}</td>
                          <td className="py-2 px-2 truncate text-muted-foreground" title={f.conceptos}>{f.conceptos || "—"}</td>
                          <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmtPesos(f.total)}</td>
                          <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">{f.pagado ? fmtPesos(f.pagado) : "—"}</td>
                          <td className={cn("py-2 pl-2 text-right tabular-nums whitespace-nowrap", deuda ? "font-semibold" : "text-muted-foreground")}>
                            {deuda ? fmtPesos(f.total - f.pagado) : "—"}
                          </td>
                        </tr>
                        {ab && f.pagos.map((p, i) => (
                          <tr key={`${f.comprobante}-p${i}`} className={cn("border-b border-zinc-100 dark:border-zinc-800 text-xs text-muted-foreground", res && "bg-sky-50/50 dark:bg-sky-950/20")}>
                            <td />
                            <td colSpan={3} className="py-1.5 px-2 tabular-nums">
                              ↳ pago {fmtFecha(p.fecha)}{p.medio ? ` · ${p.medio}` : ""}
                              {p.orden && (
                                <button type="button" onClick={(e) => { e.stopPropagation(); setOpMx({ orden: p.orden!, fecha: p.fecha }); }}
                                  className="ml-1.5 text-sky-700 dark:text-sky-400 hover:underline">· OP {p.orden} ›</button>
                              )}
                            </td>
                            <td />
                            <td className="py-1.5 px-2 text-right tabular-nums">{fmtPesos(p.importe)}</td>
                            <td />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="px-5 py-2 border-t border-zinc-200 dark:border-zinc-700 text-[11px] text-muted-foreground shrink-0">
            Solo lectura · pagos del informe 80 de MaxiRest. Cargar pagos y facturas desde acá llega en la etapa siguiente.
          </div>
        </>
      )}

      {opMx && (
        <OpMaxirestModal pdvId={pdvId} orden={opMx.orden} fecha={opMx.fecha}
          onCambiar={(fecha) => setOpMx({ ...opMx, fecha })} onCerrar={() => setOpMx(null)} />
      )}
    </div>
  );
}

// Modal propio (desde el proveedor de Detalle de compras o desde Impagas).
export function CtaCteModal({ pdvId, codPro, resaltado, onCerrar }: {
  pdvId: number; codPro: string; resaltado?: string | null; onCerrar: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent showCloseButton className="w-[calc(100vw-2rem)] sm:max-w-[1000px] h-[min(86vh,760px)] flex flex-col gap-0 p-0 overflow-hidden">
        <CtaCteContenido pdvId={pdvId} codPro={codPro} resaltado={resaltado} conCerrar
          titulo={(t) => <DialogTitle className="text-base font-semibold">{t}</DialogTitle>} />
      </DialogContent>
    </Dialog>
  );
}
