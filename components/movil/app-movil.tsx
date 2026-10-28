"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Camera, ChevronLeft, ChevronRight, CircleDot, Home, PenLine, Plus, Receipt } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import type { Local } from "@/lib/types/domain";
import { agrupar, separar, saldo, type ComprobanteImpago, type ImpagasResponse } from "@/lib/impagas/clasificar";
import { agruparPorDia, horaDe, partesDescripcion, TITULO_ACCION } from "@/lib/actividad/formato";
import { leerQrArca, type DatosQr } from "@/lib/movil/qr-arca";
import { leerQrDeArchivo } from "./leer-qr";
import type { ProyeccionMes } from "@/lib/dashboard/proyeccion";
import { frescura, hoyArgentina, type Frescura } from "@/lib/dashboard/frescura";
import { proyectarGastos } from "@/lib/movil/proyeccion-gastos";
import { claveDescarte, totales, type ItemSinCarga, type MesSinCarga } from "@/lib/sin-carga/estado";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { nombrePeriodo } from "@/lib/gastos-varios/periodo";
import { FacturaMovil } from "./factura-movil";
import { GastoMovil } from "./gasto-movil";
import { FacturaVerMovil } from "./factura-ver-movil";

// Lazarillo en el celular (Diego 27/10/2026): ver el mes, cargar facturas (con el QR
// de ARCA de la foto) y ver lo que se debe. Mismo login y mismos datos que el Panel.

type Tab = "inicio" | "cargar" | "impagas" | "actividad" | "sincarga";
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const $ = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");
const LS_PDV = "movil:pdv";

function leerPdv(): { localId: number; pdvId: number } | null {
  try { const v = JSON.parse(localStorage.getItem(LS_PDV) ?? "null"); return v?.pdvId ? v : null; } catch { return null; }
}

export function AppMovil() {
  const [tab, setTab] = useState<Tab>("inicio");
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const pdvs = useMemo(() => (locales ?? []).flatMap((l) => l.puntosDeVenta.map((p) => ({ localId: l.id, pdvId: p.id, label: `${l.nombre} · ${p.nombre}` }))), [locales]);
  // El PDV elegido se recuerda en el celular (la lista llega del servidor después: no hay desfasaje al hidratar).
  const [sel, setSel] = useState<{ localId: number; pdvId: number } | null>(() => (typeof window === "undefined" ? null : leerPdv()));
  const actual = pdvs.find((p) => p.pdvId === sel?.pdvId) ?? pdvs[0] ?? null;
  const elegir = (pdvId: number) => {
    const p = pdvs.find((x) => x.pdvId === pdvId);
    if (!p) return;
    setSel({ localId: p.localId, pdvId: p.pdvId });
    try { localStorage.setItem(LS_PDV, JSON.stringify({ localId: p.localId, pdvId: p.pdvId })); } catch { /* sin almacenamiento */ }
  };

  // Carga
  const [carga, setCarga] = useState<{ qr: DatosQr | null } | { gasto: true } | { sc: ItemSinCarga; mes: string } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [errorQr, setErrorQr] = useState<string | null>(null);
  const fotoRef = useRef<HTMLInputElement | null>(null);
  async function conFoto(file: File | undefined) {
    if (!file) return;
    setErrorQr(null);
    setLeyendo(true);
    try {
      const txt = await leerQrDeArchivo(file);
      const qr = txt ? leerQrArca(txt) : null;
      if (!qr) { setErrorQr(txt ? "El QR no es de una factura de ARCA." : "No encontré el QR en la foto. Probá más cerca, con luz y sin que se mueva, o cargala a mano."); return; }
      setCarga({ qr });
    } catch {
      setErrorQr("No se pudo leer la foto. Probá de nuevo o cargala a mano.");
    } finally {
      setLeyendo(false);
      if (fotoRef.current) fotoRef.current.value = "";
    }
  }

  const titulos: Record<Tab, string> = { inicio: "Inicio", cargar: carga ? ("gasto" in carga || ("sc" in carga && !carga.sc.proveedorId) ? "Gasto vario" : "Factura") : "Cargar", impagas: "Impagas", actividad: "Actividad", sincarga: "Sin carga" };

  return (
    <div className="flex min-h-svh flex-col bg-white dark:bg-zinc-950">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <b className="text-[19px]">{titulos[tab]}</b>
        {pdvs.length > 0 && (
          <select value={actual?.pdvId ?? ""} onChange={(e) => elegir(Number(e.target.value))}
            className="ml-auto max-w-[60%] truncate rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-[13px]">
            {pdvs.map((p) => <option key={p.pdvId} value={p.pdvId}>{p.label}</option>)}
          </select>
        )}
      </header>

      <main className="flex-1 px-4 pt-3 pb-24">
        {!actual ? <p className="py-10 text-center text-zinc-500">Cargando…</p>
          : tab === "inicio" ? <Inicio localId={actual.localId} pdvId={actual.pdvId} irImpagas={() => setTab("impagas")} irSinCarga={() => setTab("sincarga")} />
          : tab === "sincarga" ? <SinCarga pdvId={actual.pdvId} nombrePdv={(id) => pdvs.find((p) => p.pdvId === id)?.label ?? "otro PDV"} onCargar={(sc, mes) => { setCarga({ sc, mes }); setTab("cargar"); }} />
          : tab === "impagas" ? <Impagas pdvId={actual.pdvId} />
          : tab === "actividad" ? <Actividad />
          : carga && "sc" in carga ? (() => {
            // Lo que llega por apertura se carga en su PDV de origen, por el importe entero.
            const o = pdvs.find((p) => p.pdvId === carga.sc.pdvOrigenId) ?? actual;
            return carga.sc.proveedorId
              ? <FacturaMovil key={carga.sc.clave} qr={null} proveedorId={carga.sc.proveedorId} localId={o.localId} pdvId={o.pdvId} onCerrar={() => { setCarga(null); setTab("sincarga"); }} />
              : <GastoMovil key={carga.sc.clave} pdvId={o.pdvId} inicial={{ conceptoCodigo: carga.sc.conceptoCodigo, periodo: carga.mes, importe: carga.sc.ultimoTotal }} onCerrar={() => { setCarga(null); setTab("sincarga"); }} />;
          })()
          : carga && "gasto" in carga ? <GastoMovil key={actual.pdvId} pdvId={actual.pdvId} onCerrar={() => setCarga(null)} />
          : carga ? <FacturaMovil key={JSON.stringify(carga.qr)} qr={carga.qr} localId={actual.localId} pdvId={actual.pdvId} onCerrar={() => setCarga(null)} />
          : (
            <div className="flex flex-col gap-3">
              <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void conFoto(e.target.files?.[0])} />
              <BotonGrande cls="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" icono={<Camera className="size-6" />}
                titulo={leyendo ? "Leyendo el QR…" : "Factura con foto"} sub="Sacale foto al QR de la factura: se completa proveedor, número, fecha y total."
                onClick={() => fotoRef.current?.click()} />
              {errorQr && <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-[13px] text-amber-800">{errorQr}</div>}
              <BotonGrande cls="bg-zinc-100 dark:bg-zinc-800" icono={<PenLine className="size-6" />}
                titulo="Factura a mano" sub="Sin foto: proveedor, número, fecha e importes." onClick={() => setCarga({ qr: null })} />
              <BotonGrande cls="bg-[#5BC2EA]/25" icono={<Receipt className="size-6" />}
                titulo="Ticket / gasto" sub="Gasto vario: período, concepto e importe. Pagado o impago." onClick={() => setCarga({ gasto: true })} />
              <p className="mt-2 text-[12px] text-zinc-500">La foto se lee en el celular y no se guarda: solo se usa para leer el QR.</p>
            </div>
          )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
        {([["inicio", Home, "Inicio"], ["cargar", Plus, "Cargar"], ["impagas", CircleDot, "Impagas"], ["actividad", Bell, "Actividad"]] as const).map(([k, Icono, t]) => (
          <button key={k} type="button" onClick={() => { setTab(k); if (k !== "cargar") setCarga(null); }}
            className={cn("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px]", tab === k ? "font-bold text-zinc-900 dark:text-white" : "text-zinc-500")}>
            <Icono className="size-5" />{t}
          </button>
        ))}
      </nav>
    </div>
  );
}

function BotonGrande({ cls, icono, titulo, sub, onClick, deshabilitado }: { cls: string; icono: React.ReactNode; titulo: string; sub: string; onClick?: () => void; deshabilitado?: boolean }) {
  return (
    <button type="button" disabled={deshabilitado} onClick={onClick} className={cn("flex items-center gap-4 rounded-2xl p-4 text-left disabled:cursor-not-allowed", cls)}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/20">{icono}</span>
      <span><b className="block text-[16px]">{titulo}</b><span className="text-[13px] opacity-80">{sub}</span></span>
    </button>
  );
}

type Resumen = { ventas: number; gastos: number; resultado: number; rubros: { rubro: string; total: number }[] };

function Inicio({ localId, pdvId, irImpagas, irSinCarga }: { localId: number; pdvId: number; irImpagas: () => void; irSinCarga: () => void }) {
  const ahora = new Date();
  const [ym, setYm] = useState({ anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 });
  const mover = (d: number) => setYm((x) => { let m = x.mes + d, a = x.anio; if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; } return { anio: a, mes: m }; });
  const { data, isLoading } = useFetchQuery<Resumen>(
    ["m-resumen", localId, pdvId, ym.anio, ym.mes], `/api/m/resumen?localId=${localId}&pdvId=${pdvId}&anio=${ym.anio}&mes=${ym.mes}`);
  const { data: imp } = useFetchQuery<ImpagasResponse>(["impagas", pdvId, null], `/api/impagas?pdvId=${pdvId}`);
  // Real / Proyección (Diego 28/10): las ventas al cierre son la misma proyección del tooltip
  // de Ingresos del Panel; los gastos todavía no se proyectan (quedan en gris).
  const [proyectar, setProyectar] = useState(false);
  const { data: pr, isLoading: cargandoPr } = useFetchQuery<{ proyeccion: ProyeccionMes | null }>(
    ["proyeccion-ingresos", ym.anio, localId, pdvId], proyectar ? `/api/dashboard/proyeccion?year=${ym.anio}&localId=${localId}&pdvId=${pdvId}` : null, { staleTime: 5 * 60_000 });
  const proy = pr?.proyeccion && pr.proyeccion.anio === ym.anio && pr.proyeccion.mes === ym.mes ? pr.proyeccion : null;
  // Sin carga del mes en curso: la tarjeta y la proyección de gastos (Diego 28/10): gastos al
  // cierre = cargado + lo que falta cargar (Sin carga) + la mercadería que falta según los días de venta.
  const { data: sc } = useFetchQuery<{ meses: MesSinCarga[] }>(["sin-carga", pdvId], `/api/sin-carga?pdvId=${pdvId}`, { staleTime: 60_000 });
  const scMes = sc?.meses[0];
  const scTot = scMes ? totales(scMes.items, false) : null;
  // Los 3 meses cerrados anteriores (para el promedio por rubro y el food cost de la proyección).
  const previos = [1, 2, 3].map((k) => { const t = ym.anio * 12 + (ym.mes - 1) - k; return { anio: Math.floor(t / 12), mes: (t % 12) + 1 }; });
  const h1 = useFetchQuery<Resumen>(["m-resumen", localId, pdvId, previos[0].anio, previos[0].mes], proyectar ? `/api/m/resumen?localId=${localId}&pdvId=${pdvId}&anio=${previos[0].anio}&mes=${previos[0].mes}` : null);
  const h2 = useFetchQuery<Resumen>(["m-resumen", localId, pdvId, previos[1].anio, previos[1].mes], proyectar ? `/api/m/resumen?localId=${localId}&pdvId=${pdvId}&anio=${previos[1].anio}&mes=${previos[1].mes}` : null);
  const h3 = useFetchQuery<Resumen>(["m-resumen", localId, pdvId, previos[2].anio, previos[2].mes], proyectar ? `/api/m/resumen?localId=${localId}&pdvId=${pdvId}&anio=${previos[2].anio}&mes=${previos[2].mes}` : null);
  const historia = [h1.data, h2.data, h3.data].filter((x): x is Resumen => !!x && x.ventas > 0);
  // Gastos al cierre (Diego 28/10): cargado + lo que falta cargar (Sin carga) y, por rubro, nunca
  // menos que su promedio de los 3 meses cerrados (Mercaderías: food cost promedio × ventas proyectadas).
  const gastosProy = (() => {
    if (!proy || !data || !scMes || scMes.mes !== `${ym.anio}-${String(ym.mes).padStart(2, "0")}`) return null;
    const p = proyectarGastos({ cargado: data.rubros, sinCargar: scMes.items, historia, ventasProy: proy.proyeccion });
    return { ...p, resultado: proy.proyeccion - p.total };
  })();
  const enProy = proyectar && !!gastosProy && !!proy;
  const ingresos = enProy ? proy!.proyeccion : data?.ventas ?? 0;
  const rubrosVista = enProy ? gastosProy!.rubros : (data?.rubros ?? []);
  const deRubro = (re: RegExp) => rubrosVista.filter((r) => re.test(r.rubro)).reduce((s, r) => s + r.total, 0);
  const pctIng = (n: number) => (ingresos > 0 ? `${((n / ingresos) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%` : "—");
  const kpiListo = !!data && (!proyectar || enProy);
  const foodCost = deRubro(/mercader/i);
  const costoMix = foodCost + deRubro(/personal/i);
  const deuda = useMemo(() => {
    if (!imp) return null;
    const { impagas } = separar(imp.data);
    return { saldo: impagas.reduce((s, f) => s + saldo(f), 0), n: impagas.length };
  }, [imp]);
  return (
    <div>
      <Actualizado localId={localId} pdvId={pdvId} />
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={() => mover(-1)} className="size-10 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center"><ChevronLeft className="size-5" /></button>
        <div className="flex-1 text-center font-bold">{MESES[ym.mes - 1]} {ym.anio}</div>
        <button type="button" onClick={() => mover(1)} className="size-10 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center"><ChevronRight className="size-5" /></button>
      </div>
      <div className="mb-3 flex rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1">
        {([[false, "Real"], [true, "Proyección"]] as const).map(([v, t]) => (
          <button key={t} type="button" onClick={() => setProyectar(v)}
            className={cn("flex-1 rounded-lg py-2 text-[14px] font-semibold", proyectar === v ? "bg-white dark:bg-zinc-950 shadow-sm" : "text-zinc-500")}>{t}</button>
        ))}
      </div>
      {proyectar ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {proy ? (
              <div className="rounded-2xl border border-[#5BC2EA] bg-[#5BC2EA]/10 px-3 py-2.5">
                <div className="text-[11.5px] text-zinc-500">Ventas al cierre</div>
                <b className="text-[17px] tabular-nums text-sky-700 dark:text-sky-300">{$(proy.proyeccion)}</b>
                <div className="text-[11px] text-zinc-500">{proy.backtest ? `± ${Math.round(proy.backtest.errorMetodo * 100)}% · ` : ""}real {$(proy.facturado)} ({proy.diasTranscurridos} de {proy.diasMes} días)</div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"><i className="block h-full bg-[#5BC2EA]" style={{ width: `${Math.round((proy.diasTranscurridos / proy.diasMes) * 100)}%` }} /></div>
              </div>
            ) : <Kpi t="Ventas al cierre" v={cargandoPr ? "…" : "—"} cls="text-zinc-300" />}
            {gastosProy ? (
              <div className="rounded-2xl border border-[#5BC2EA] bg-[#5BC2EA]/10 px-3 py-2.5">
                <div className="text-[11.5px] text-zinc-500">Gastos al cierre</div>
                <b className="text-[17px] tabular-nums text-sky-700 dark:text-sky-300">{$(gastosProy.total)}</b>
                <div className="text-[11px] text-zinc-500">estimado</div>
              </div>
            ) : <Kpi t="Gastos al cierre" v={cargandoPr ? "…" : "—"} cls="text-zinc-300" />}
            <Kpi t="Resultado" v={gastosProy ? $(gastosProy.resultado) : "—"} cls={gastosProy ? (gastosProy.resultado >= 0 ? "text-emerald-700" : "text-red-600") : "text-zinc-300"} />
            <Kpi t="Gastos / ventas" v={gastosProy && proy ? `${((gastosProy.total / proy.proyeccion) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%` : "—"} cls={gastosProy ? undefined : "text-zinc-300"} />
          </div>
          {gastosProy && (
            <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
              Gastos = cargado {$(gastosProy.cargado)} + sin cargar {$(gastosProy.sinCargar)} + variables {$(gastosProy.variable)} (lo que falta para llegar al promedio de cada rubro de los últimos {historia.length} meses; mercadería según el food cost).
            </p>
          )}
          {!proy && !cargandoPr && <p className="mt-2 text-[12px] text-zinc-500">Solo se proyecta el mes en curso, mientras le falten días de ventas.</p>}
        </>
      ) : (
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi t="Ventas" v={isLoading ? "…" : $(data?.ventas ?? 0)} />
        <Kpi t="Gastos" v={isLoading ? "…" : $(data?.gastos ?? 0)} />
        <Kpi t="Resultado" v={isLoading ? "…" : $(data?.resultado ?? 0)} cls={(data?.resultado ?? 0) >= 0 ? "text-emerald-700" : "text-red-600"} />
        <Kpi t="Gastos / ventas" v={isLoading || !data?.ventas ? "—" : `${((data.gastos / data.ventas) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`} />
      </div>
      )}
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <Kpi t={`Food cost${enProy ? " al cierre" : ""}`} v={kpiListo ? pctIng(foodCost) : "—"} cls={kpiListo ? undefined : "text-zinc-300"} />
        <Kpi t={`Costo mix${enProy ? " al cierre" : ""}`} v={kpiListo ? pctIng(costoMix) : "—"} cls={kpiListo ? undefined : "text-zinc-300"} />
      </div>
      <p className="mt-1 text-[11.5px] text-zinc-500">Food cost = mercadería / ventas · Costo mix = (personal + mercadería) / ventas.</p>
      <button type="button" onClick={irImpagas} className="mt-3 block w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 text-left">
        <div className="flex justify-between"><b>Deuda con proveedores</b><span className="text-sky-700">ver ›</span></div>
        <div className="my-1 text-[24px] font-bold">{deuda ? $(deuda.saldo) : "…"}</div>
        {deuda && <div className="text-[12.5px] text-zinc-500">{deuda.n} factura{deuda.n === 1 ? "" : "s"} impaga{deuda.n === 1 ? "" : "s"}</div>}
      </button>
      {scMes && scTot && (
        <button type="button" onClick={irSinCarga} className="mt-3 block w-full rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 p-4 text-left">
          <div className="flex justify-between"><b>Sin carga · {nombrePeriodo(scMes.mes)}</b><span className="text-sky-700">ver ›</span></div>
          <div className="my-1 text-[24px] font-bold">{$(scTot.total)}</div>
          <div className="text-[12.5px] text-zinc-500">{scTot.n ? `${scTot.n} gasto${scTot.n === 1 ? "" : "s"} de todos los meses sin cargar` : "Está todo cargado"}</div>
        </button>
      )}
      <div className="mt-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="flex items-baseline justify-between"><b>Gastos del mes por rubro{enProy ? " · proyectado" : ""}</b><span className="text-[11.5px] text-zinc-500">% ing</span></div>
        {rubrosVista.map((r) => (
          <div key={r.rubro} className="flex items-baseline gap-2 border-b border-zinc-100 dark:border-zinc-800 py-2 last:border-0 text-[14px]">
            <span className="min-w-0 flex-1 truncate">{r.rubro}</span>
            <b className={cn("tabular-nums", enProy && "text-sky-700 dark:text-sky-300")}>{$(r.total)}</b>
            <span className="w-12 shrink-0 text-right text-[12.5px] tabular-nums text-zinc-500">{pctIng(r.total)}</span>
          </div>
        ))}
        {data && !data.rubros.length && <p className="pt-2 text-[13px] text-zinc-500">Sin gastos en el mes.</p>}
      </div>
      <Link href="/dashboard?completa=1" className="mt-4 block text-center text-[13px] text-sky-700 underline">Abrir el Panel completo</Link>
    </div>
  );
}

// Chip "actualizado al" del PDV elegido, como en el Panel (Diego 28/10): punto verde hasta
// ayer, ámbar 2-3 días, rojo más viejo; con la fecha de las últimas ventas y compras.
const PUNTO: Record<Frescura, string> = { al_dia: "bg-emerald-600", atrasado: "bg-amber-500", viejo: "bg-red-600" };
const LEYENDA: Record<Frescura, string> = { al_dia: "al día", atrasado: "atrasado", viejo: "desactualizado" };
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
function Actualizado({ localId, pdvId }: { localId: number; pdvId: number }) {
  const { data } = useFetchQuery<{ ventas: string | null; compras: string | null }>(
    ["actualizado-al", localId, pdvId], `/api/dashboard/actualizado?localId=${localId}&pdvId=${pdvId}`, { staleTime: 5 * 60_000 });
  const base = data?.ventas ?? data?.compras;
  if (!base) return null;
  const estado = frescura(base, hoyArgentina());
  return (
    <div className="mb-3 flex justify-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-[12.5px]">
        <span className={cn("size-2 shrink-0 rounded-full", PUNTO[estado])} />
        {LEYENDA[estado]}
        {data?.ventas && <> · ventas {ddmm(data.ventas)}</>}
        {data?.compras && <> · compras {ddmm(data.compras)}</>}
      </span>
    </div>
  );
}

function Kpi({ t, v, cls }: { t: string; v: string; cls?: string }) {
  return <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 px-3 py-2.5"><div className="text-[11.5px] text-zinc-500">{t}</div><b className={cn("text-[17px] tabular-nums", cls)}>{v}</b></div>;
}

function Impagas({ pdvId }: { pdvId: number }) {
  const { data, isLoading } = useFetchQuery<ImpagasResponse>(["impagas", pdvId, null], `/api/impagas?pdvId=${pdvId}`);
  const grupos = useMemo(() => (data ? agrupar(separar(data.data).impagas, "saldo") : []), [data]);
  const [abierto, setAbierto] = useState<string | null>(null);
  // Tocar una factura la abre (Diego 28/10): renglones, total y pagos, solo lectura.
  const [ver, setVer] = useState<ComprobanteImpago | null>(null);
  const total = grupos.reduce((s, g) => s + g.saldo, 0);
  if (isLoading) return <p className="py-10 text-center text-zinc-500">Cargando…</p>;
  if (ver) return <FacturaVerMovil imp={ver} onVolver={() => setVer(null)} />;
  return (
    <div>
      <div className="mb-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4"><div className="text-[12.5px] text-zinc-500">Total que se debe</div><div className="text-[24px] font-bold">{$(total)}</div></div>
      {grupos.map((g) => (
        <div key={g.clave} className="border-b border-zinc-100 dark:border-zinc-800">
          <button type="button" onClick={() => setAbierto(abierto === g.clave ? null : g.clave)} className="flex w-full items-center gap-2 py-3 text-left">
            <span className="size-2 shrink-0 rounded-full bg-red-600" />
            <span className="min-w-0 flex-1"><span className="block truncate">{g.proveedor}</span>
              <span className="text-[12px] text-zinc-500">{g.items.length} factura{g.items.length === 1 ? "" : "s"} · más vieja {g.masVieja.split("-").reverse().join("/")}</span></span>
            <b className="tabular-nums">{$(g.saldo)}</b>
          </button>
          {abierto === g.clave && g.items.map((f) => (
            <button key={f.id} type="button" onClick={() => setVer(f)} className="flex w-full items-center justify-between gap-2 pb-2.5 pl-4 text-left text-[13px] text-zinc-600 dark:text-zinc-300">
              <span>{f.fecha.split("-").reverse().join("/")} · {f.comprobante}</span>
              <span className="flex items-center gap-1 tabular-nums">{$(saldo(f))}<ChevronRight className="size-4 text-zinc-400" /></span>
            </button>
          ))}
        </div>
      ))}
      {!grupos.length && <p className="py-6 text-center text-zinc-500">No hay facturas impagas.</p>}
      <p className="mt-3 text-[12px] text-zinc-500">Para pagar, por ahora: la cuenta corriente del proveedor en el Panel.</p>
    </div>
  );
}

// "Sin carga" en el celu (Diego 28/10): por mes, lo que se carga todos los meses y falta.
// Tocar un gasto lo carga: factura del proveedor, o gasto vario con concepto, período e importe.
function SinCarga({ pdvId, onCargar, nombrePdv }: { pdvId: number; onCargar: (x: ItemSinCarga, mes: string) => void; nombrePdv: (id: number | null) => string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useFetchQuery<{ meses: MesSinCarga[] }>(["sin-carga", pdvId], `/api/sin-carga?pdvId=${pdvId}`, { staleTime: 60_000 });
  const [abierto, setAbierto] = useState<string | null>(null);
  // Deslizar (Diego 28/10): a la izquierda "Este mes no" (sigue los próximos meses), a la derecha
  // "Ya no va" (no es de todos los meses o ya no se contrata). Con "Deshacer" en el aviso.
  async function descartar(x: ItemSinCarga, mes: string | null) {
    const r = await fetch("/api/sin-carga/descartes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdvId, clave: claveDescarte(x.clave, mes), nombre: x.nombre }) });
    const d = await r.json().catch(() => null);
    if (!r.ok) { toast.error("No se pudo marcar"); return; }
    void queryClient.invalidateQueries({ queryKey: ["sin-carga"] });
    toast(mes ? `${x.nombre}: este mes no` : `${x.nombre}: ya no va`, {
      action: { label: "Deshacer", onClick: () => { void fetch(`/api/sin-carga/descartes?id=${d?.id}`, { method: "DELETE" }).then(() => queryClient.invalidateQueries({ queryKey: ["sin-carga"] })); } },
    });
  }
  if (isLoading || !data) return <p className="py-10 text-center text-zinc-500">Cargando…</p>;
  const mes0 = data.meses[0];
  return (
    <div>
      <div className="mb-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="text-[12.5px] text-zinc-500">{nombrePeriodo(mes0.mes)} · esperado sin cargar</div>
        <div className="text-[24px] font-bold">{$(totales(mes0.items, false).total)}</div>
      </div>
      {data.meses.map((m) => {
        const t = totales(m.items, false);
        const ver = (abierto ?? mes0.mes) === m.mes;
        return (
          <div key={m.mes} className="border-b border-zinc-100 dark:border-zinc-800">
            <button type="button" onClick={() => setAbierto(ver ? "" : m.mes)} className="flex w-full items-center gap-2 py-3 text-left font-bold">
              {nombrePeriodo(m.mes)}<span className="ml-auto text-[13px] font-normal text-zinc-500">{t.n ? `${t.n} · ${$(t.total)}` : "todo cargado"}</span>
            </button>
            {ver && t.visibles.map((x) => (
              <Deslizable key={x.clave} onTap={() => onCargar(x, m.mes)} onIzquierda={() => void descartar(x, m.mes)} onDerecha={() => void descartar(x, null)}>
                <span className={cn("size-2 shrink-0 rounded-full", x.atrasado ? "bg-red-600" : "bg-zinc-300")} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{x.nombre}</span>
                  <span className={cn("block truncate text-[12px]", x.atrasado ? "text-red-600" : "text-zinc-500")}>{x.atrasado ? "atrasado" : "por venir"} · {x.vencido ? "mes vencido" : `suele el ${x.dia}`} · {x.rubro}</span>
                  {x.pdvOrigenId && x.pdvOrigenId !== pdvId && <span className="block truncate text-[11.5px] text-zinc-400">se carga en {nombrePdv(x.pdvOrigenId)} · {$(x.ultimoTotal)}</span>}</span>
                <b className="tabular-nums">{$(x.ultimo)}</b>
              </Deslizable>
            ))}
          </div>
        );
      })}
      <p className="mt-3 text-[12px] text-zinc-500">Tocá un gasto para cargarlo. Deslizalo ← “Este mes no” · → “Ya no va”.</p>
    </div>
  );
}

// Fila que se desliza: ← (izquierda) y → (derecha) disparan una acción pasado el umbral; tocar, otra.
const UMBRAL = 90;
function Deslizable({ children, onTap, onIzquierda, onDerecha }: { children: React.ReactNode; onTap: () => void; onIzquierda: () => void; onDerecha: () => void }) {
  const [dx, setDx] = useState(0);
  const [arrastra, setArrastra] = useState(false);
  const ini = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null);
  const fin = () => {
    const d = dx; ini.current = null; setDx(0); setArrastra(false);
    if (d <= -UMBRAL) onIzquierda(); else if (d >= UMBRAL) onDerecha();
  };
  return (
    <div className="relative overflow-hidden border-t border-zinc-50 dark:border-zinc-900">
      <div className={cn("absolute inset-0 flex items-center px-4 text-[13px] font-bold text-white", dx > 0 ? "justify-start bg-red-600" : "justify-end bg-amber-500")}>
        {dx > 0 ? "Ya no va →" : "← Este mes no"}
      </div>
      <div className="relative flex w-full items-center gap-2.5 bg-white dark:bg-zinc-950 py-2.5 text-left touch-pan-y select-none"
        style={{ transform: `translateX(${dx}px)`, transition: arrastra ? "none" : "transform .2s" }}
        onPointerDown={(e) => { ini.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: null }; }}
        onPointerMove={(e) => {
          const s = ini.current; if (!s || s.id !== e.pointerId) return;
          const mx = e.clientX - s.x, my = e.clientY - s.y;
          if (s.horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
            s.horizontal = Math.abs(mx) > Math.abs(my);
            if (s.horizontal) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setArrastra(true); }
          }
          if (s.horizontal) setDx(Math.max(-140, Math.min(140, mx)));
        }}
        onPointerUp={() => { const s = ini.current; if (s && s.horizontal === null) { ini.current = null; onTap(); return; } fin(); }}
        onPointerCancel={() => { ini.current = null; setDx(0); setArrastra(false); }}>
        {children}
      </div>
    </div>
  );
}

function Actividad() {
  const { data } = useFetchQuery<{ data: { id: number; tipo: string; descripcion: string; accion: string; usuario: string | null; creadoEn: string }[] }>(["actividad", "todos"], "/api/actividad?todos=1&limite=40");
  const dias = useMemo(() => agruparPorDia(data?.data ?? []), [data]);
  return (
    <div>
      {dias.map((d) => (
        <div key={d.dia}>
          <div className="mt-3 mb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500">{d.dia}</div>
          {d.items.map((a) => {
            const p = partesDescripcion(a.descripcion);
            return (
              <div key={a.id} className="flex justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 py-2.5">
                <span className="min-w-0"><span className="block truncate">{TITULO_ACCION[a.tipo]?.[a.accion] ?? a.accion}{p.nombre ? ` · ${p.nombre}` : ""}</span><span className="block truncate text-[12px] text-zinc-500">{p.detalle}</span></span>
                <span className="shrink-0 text-[12px] text-zinc-500">{horaDe(new Date(a.creadoEn))}</span>
              </div>
            );
          })}
        </div>
      ))}
      {data && !data.data.length && <p className="py-6 text-center text-zinc-500">Sin actividad.</p>}
    </div>
  );
}
