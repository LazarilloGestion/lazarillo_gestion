"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { cn } from "@/lib/utils";
import { fmtMillones, fmtPesos } from "@/lib/impagas/clasificar";
import { nombrePeriodo } from "@/lib/gastos-varios/periodo";
import { CHICO, claveDescarte, mesDeDescarte, totales, type ItemSinCarga, type MesSinCarga } from "@/lib/sin-carga/estado";
import type { Local } from "@/lib/types/domain";
import { refrescarCompras, useCargaFactura } from "@/components/facturas/cargar-factura";
import ModalNuevaCarga from "@/components/facturas/modal-carga-factura";
import { VerFactura } from "@/components/facturas/ver-factura";
import { ARCA_KEY, ctxArca, ListaArca, ListaCorregir, SubirArca, useCruceArca, type CompArca } from "./arca";

// Botón "● Sin carga · $X M" al lado de Impagas (Diego, 28/10/2026) y su listado: por mes,
// los gastos que se cargan todos los meses y todavía no están en el PDV. "Cargar" abre la
// carga precargada (proveedor, o gasto vario con concepto, período e importe del último mes).
// Desde el 28/10 tiene tres fuentes: "Por proyección" (lo de arriba), "ARCA" (comprobantes que
// ARCA dice que te facturaron y no están cargados) y "Corregir" (cargados distinto que en ARCA).
// Fusión: si un proveedor tiene un comprobante de ARCA sin cargar en el mes, la proyección de ese
// proveedor en ese mes no se muestra (ya está en ARCA, con el importe real).

export type SinCargaResponse = { hoy: string; meses: MesSinCarga[]; descartes: { id: number; clave: string; nombre: string | null; creadoEn: string }[] };
export const sinCargaKey = (pdvId: number | null | undefined) => ["sin-carga", pdvId ?? null];
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

export function useSinCarga(pdvId: number | null | undefined) {
  return useFetchQuery<SinCargaResponse>(sinCargaKey(pdvId), pdvId ? `/api/sin-carga?pdvId=${pdvId}` : null, { staleTime: 60_000 });
}

export function SinCargaBoton() {
  const { localId, pdvId } = useDashboard();
  const [open, setOpen] = useState(false);
  const { data } = useSinCarga(pdvId);
  const actual = data?.meses[0];
  const res = actual ? totales(actual.items, false) : null;
  if (pdvId == null) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        title="Gastos que se cargan todos los meses y este mes todavía no están"
        className={cn("h-8 px-3 flex items-center gap-2 rounded-lg border text-sm transition-all shrink-0",
          res?.n ? "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:border-amber-300"
            : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400")}>
        <span className={cn("h-2 w-2 rounded-full", res?.n ? "bg-amber-500" : "bg-zinc-300")} />
        {res ? `Sin carga · ${res.n ? fmtMillones(res.total) : "nada"}` : "Sin carga"}
      </button>
      {open && <SinCargaModal pdvId={pdvId} localId={localId ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}

function SinCargaModal({ pdvId, localId, onClose }: { pdvId: number; localId: number | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useSinCarga(pdvId);
  const { data: arca, isLoading: cargandoArca } = useCruceArca(true);
  const [cargando, setCargando] = useState<{ item: ItemSinCarga; mes: string } | null>(null);
  const [cargandoArcaC, setCargandoArcaC] = useState<CompArca | null>(null);
  const [viendo, setViendo] = useState<{ rowId: string; detalle: string } | null>(null);
  // Un gasto que llega por apertura se carga en su PDV de origen (con su regla), por el importe entero.
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const pdvCarga = cargando?.item.pdvOrigenId ?? pdvId;
  const localCarga = locales?.find((l) => l.puntosDeVenta.some((p) => p.id === pdvCarga))?.id ?? localId;
  const { maestros, pdvsRef, reglaDe } = useCargaFactura(true, pdvCarga, localCarga);
  const pdv = pdvsRef.find((p) => p.id === pdvId);
  const nombrePdv = (id: number | null) => pdvsRef.find((p) => p.id === id)?.nombre ?? "otro PDV";
  const [tab, setTab] = useState<"sin" | "arca" | "corregir" | "no">("sin");
  const [chicos, setChicos] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const actual = data?.meses[0]?.mes;
  const estaAbierto = (mes: string) => (mes === actual) !== abiertos.has(mes);

  // Fusión con ARCA: proveedor + mes con comprobante de ARCA sin cargar → sale de la proyección.
  const enArca = useMemo(() => new Set((arca?.faltan ?? []).filter((c) => c.proveedorId).map((c) => `${c.proveedorId}@${c.mes}`)), [arca]);
  const meses = useMemo(() => (data?.meses ?? []).map((m) => ({ ...m, items: m.items.filter((x) => !(x.proveedorId && enArca.has(`${x.proveedorId}@${m.mes}`))) })), [data, enArca]);
  const fusionados = (data?.meses ?? []).reduce((s, m) => s + m.items.length, 0) - meses.reduce((s, m) => s + m.items.length, 0);

  const kpi = useMemo(() => {
    if (!data) return null;
    const todos = meses.flatMap((m) => totales(m.items, chicos).visibles);
    const at = todos.filter((x) => x.atrasado);
    const pv = totales(meses[0]?.items ?? [], chicos).visibles.filter((x) => !x.atrasado);
    return { mes: totales(meses[0]?.items ?? [], chicos), atrasados: { n: at.length, total: at.reduce((s, x) => s + x.ultimo, 0) }, porVenir: { n: pv.length, total: pv.reduce((s, x) => s + x.ultimo, 0) }, n: todos.length };
  }, [data, meses, chicos]);
  const noVan = [
    ...(data?.descartes ?? []).map((d) => ({ ...d, origen: mesDeDescarte(d.clave) ? `solo ${nombrePeriodo(mesDeDescarte(d.clave)!)}` : null })),
    ...(arca?.descartes ?? []).map((d) => ({ ...d, origen: d.clave.startsWith("k:") ? "ARCA · revisada, está bien" : "ARCA · no se carga" })),
  ];

  // "Ya no va" (para siempre) o "Este mes no" (solo ese mes); se deshace desde "Ya no van".
  async function descartar(item: ItemSinCarga, mes: string | null) {
    const r = await fetch("/api/sin-carga/descartes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdvId, clave: claveDescarte(item.clave, mes), nombre: item.nombre }) });
    if (!r.ok) { toast.error("No se pudo marcar"); return; }
    toast.success(mes ? `${item.nombre}: no va en ${nombrePeriodo(mes)}` : `${item.nombre}: ya no va`, { description: "Lo volvés a mostrar desde la pestaña \"Ya no van\"." });
    void queryClient.invalidateQueries({ queryKey: ["sin-carga"] });
  }
  async function volver(id: number) {
    const r = await fetch(`/api/sin-carga/descartes?id=${id}`, { method: "DELETE" });
    if (!r.ok) { toast.error("No se pudo deshacer"); return; }
    void queryClient.invalidateQueries({ queryKey: ["sin-carga"] });
    void queryClient.invalidateQueries({ queryKey: ARCA_KEY });
  }

  if (viendo) {
    return <VerFactura rowId={viendo.rowId} detalle={viendo.detalle} onClose={() => { setViendo(null); void queryClient.invalidateQueries({ queryKey: ARCA_KEY }); }} />;
  }

  if (cargandoArcaC && maestros) {
    const c = cargandoArcaC;
    const { ctx, aviso } = ctxArca(c);
    return (
      <ModalNuevaCarga maestros={maestros} pdvsRef={pdvsRef} pdvActual={nombrePdv(pdvId)} reglaDe={reglaDe} ctx={ctx} aviso={aviso}
        onCerrar={() => setCargandoArcaC(null)}
        onGuardado={(d: { total: number; pago?: { id: number } | null }) => {
          setCargandoArcaC(null);
          toast.success(d.pago ? "Cargado y pagado" : "Cargado", { description: `${c.proveedor ?? c.emisor ?? c.cuit} · ${fmtPesos(d.total)}` });
          refrescarCompras(queryClient);
          void queryClient.invalidateQueries({ queryKey: ARCA_KEY });
        }} />
    );
  }

  if (cargando && maestros) {
    const { item, mes } = cargando;
    const ctx = item.proveedorId
      ? { proveedorId: item.proveedorId }
      : { modo: "vario", conceptoCodigo: item.conceptoCodigo, periodo: mes, importe: item.ultimoTotal };
    return (
      <ModalNuevaCarga maestros={maestros} pdvsRef={pdvsRef} pdvActual={nombrePdv(pdvCarga)} reglaDe={reglaDe} ctx={ctx}
        onCerrar={() => setCargando(null)}
        onGuardado={(d: { total: number; pago?: { id: number } | null }) => {
          setCargando(null);
          toast.success(d.pago ? "Cargado y pagado" : "Cargado", { description: `${item.nombre} · ${fmtPesos(d.total)}` });
          refrescarCompras(queryClient);
          void queryClient.invalidateQueries({ queryKey: ARCA_KEY });
        }} />
    );
  }

  const descripcion = tab === "arca" ? "Comprobantes que ARCA dice que te facturaron y no están cargados en ningún local. Es de la empresa (CUIT), no de este PDV: se carga en el PDV que corresponda."
    : tab === "corregir" ? "Comprobantes cargados que no coinciden con ARCA. Abrilos con Ver para corregirlos, o marcalos como revisados."
    : "Gastos que aparecieron en 3 de los últimos 4 meses y en el mes todavía no están. Solo rubros visibles en Compras.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Sin carga{pdv ? ` · ${pdv.nombre}` : ""}</h2>
            <p className="text-xs text-muted-foreground">{descripcion}</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-zinc-400 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex items-center gap-3 px-6 pb-3">
          <div className="inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-1 text-xs font-semibold">
            {([["sin", `Por proyección (${kpi?.n ?? "…"})`], ["arca", `ARCA (${arca ? arca.faltan.length : "…"})`], ["corregir", `Corregir (${arca ? arca.corregir.length : "…"})`], ["no", `Ya no van (${noVan.length})`]] as const).map(([k, t]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-md px-3 py-1.5", tab === k ? "bg-white dark:bg-zinc-950 shadow-sm" : "text-zinc-500")}>{t}</button>
            ))}
          </div>
          {tab === "sin" && (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={chicos} onChange={(e) => setChicos(e.target.checked)} /> Mostrar los chicos (menos de {fmtPesos(CHICO)})
            </label>
          )}
        </div>

        {tab === "sin" && kpi && actual && (
          <div className="grid grid-cols-3 gap-2.5 px-6 pb-3">
            <Kpi t={`${nombrePeriodo(actual)} · esperado sin cargar`} v={fmtPesos(kpi.mes.total)} sub={`${kpi.mes.n} gastos`} />
            <Kpi t="Atrasados (ya pasó el día habitual)" v={`${kpi.atrasados.n} · ${fmtMillones(kpi.atrasados.total)}`} cls="text-red-600" />
            <Kpi t="Por venir este mes" v={`${kpi.porVenir.n} · ${fmtMillones(kpi.porVenir.total)}`} />
          </div>
        )}

        {(tab === "arca" || tab === "corregir") && <SubirArca data={arca} />}
        {tab === "sin" && fusionados > 0 && (
          <p className="px-6 pb-2 text-[11px] text-sky-700 dark:text-sky-400">{fusionados} gasto{fusionados === 1 ? "" : "s"} de la proyección ya figura{fusionados === 1 ? "" : "n"} en ARCA con el comprobante real: están en la pestaña ARCA.</p>
        )}

        <div className="flex-1 overflow-y-auto border-t border-zinc-100 dark:border-zinc-800">
          {(tab === "sin" || tab === "no" ? isLoading : cargandoArca) && <p className="p-6 text-sm text-muted-foreground">Buscando…</p>}
          {tab === "arca" && arca && <ListaArca data={arca} onCargar={setCargandoArcaC} />}
          {tab === "corregir" && arca && <ListaCorregir data={arca} onVer={(rowId, detalle) => setViendo({ rowId, detalle })} />}
          {tab === "sin" && meses.map((m) => {
            const t = totales(m.items, chicos);
            const abierto = estaAbierto(m.mes);
            const porRubro = new Map<string, ItemSinCarga[]>();
            for (const x of t.visibles) porRubro.set(x.rubro, [...(porRubro.get(x.rubro) ?? []), x]);
            const rubros = [...porRubro.entries()].sort((a, b) => b[1].reduce((s, x) => s + x.ultimo, 0) - a[1].reduce((s, x) => s + x.ultimo, 0));
            return (
              <div key={m.mes}>
                <button type="button" onClick={() => setAbiertos((s) => { const n = new Set(s); if (n.has(m.mes)) n.delete(m.mes); else n.add(m.mes); return n; })}
                  className="flex w-full items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-6 py-2.5 text-left text-sm font-semibold">
                  {abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {nombrePeriodo(m.mes)}
                  <span className="ml-auto font-normal text-muted-foreground">{t.n ? `${t.n} gasto${t.n === 1 ? "" : "s"} · ${fmtPesos(t.total)}` : "nada sin cargar"}</span>
                </button>
                {abierto && rubros.map(([rubro, items]) => (
                  <div key={rubro}>
                    <div className="flex px-6 pl-10 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                      {rubro}<span className="ml-auto">{items.length} · {fmtPesos(items.reduce((s, x) => s + x.ultimo, 0))}</span>
                    </div>
                    {items.map((x) => (
                      <div key={x.clave} className="grid grid-cols-[12px_1fr_160px_110px_auto] items-center gap-3 border-b border-zinc-50 dark:border-zinc-800 px-6 pl-10 py-1.5 text-sm">
                        <span className={cn("h-2 w-2 rounded-full", x.atrasado ? "bg-red-600" : "bg-zinc-300")} />
                        <span className="min-w-0"><span className="block truncate font-medium">{x.nombre}</span><span className="block truncate text-[11px] text-zinc-400">{x.detalle}{x.pdvOrigenId && x.pdvOrigenId !== pdvId ? ` · se carga en ${nombrePdv(x.pdvOrigenId)} (${fmtPesos(x.ultimoTotal)})` : ""}</span></span>
                        <span className={cn("text-xs", x.atrasado ? "text-red-600" : "text-zinc-500")}>
                          {x.atrasado ? "atrasado" : "por venir"} · {x.vencido ? `mes vencido (${ddmm(x.vence)})` : `suele el ${x.dia}`}
                        </span>
                        <span className="text-right font-semibold tabular-nums" title="Lo del último mes en que se cargó">{fmtPesos(x.ultimo)}</span>
                        <span className="flex gap-1.5">
                          <button type="button" disabled={!maestros} onClick={() => setCargando({ item: x, mes: m.mes })}
                            className="h-7 rounded-md bg-zinc-900 px-2.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900">Cargar</button>
                          <button type="button" onClick={() => void descartar(x, m.mes)} title="No vino este mes (sigue apareciendo los próximos)" className="h-7 rounded-md border border-zinc-300 dark:border-zinc-600 px-2.5 text-xs font-semibold">Este mes no</button>
                          <button type="button" onClick={() => void descartar(x, null)} title="No es de todos los meses o ya no se contrata" className="h-7 rounded-md border border-zinc-300 dark:border-zinc-600 px-2.5 text-xs font-semibold">Ya no va</button>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
          {tab === "no" && (
            <div className="p-6">
              {!noVan.length && <p className="text-sm text-muted-foreground">No marcaste ningún gasto como “Ya no va”.</p>}
              {noVan.map((d) => (
                <div key={d.id} className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{d.nombre ?? d.clave}{d.origen ? <span className="text-xs text-muted-foreground"> · {d.origen}</span> : null}</span>
                  <span className="text-xs text-muted-foreground">desde {ddmm(d.creadoEn.slice(0, 10))}</span>
                  <button type="button" onClick={() => void volver(d.id)} className="h-7 rounded-md border border-zinc-300 dark:border-zinc-600 px-2.5 text-xs font-semibold">Volver a mostrar</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ t, v, sub, cls }: { t: string; v: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{t}</div>
      <div className={cn("text-base font-semibold tabular-nums", cls)}>{v}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
