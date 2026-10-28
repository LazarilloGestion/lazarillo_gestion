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
import { difPp, indicadores, promedioMensual } from "@/lib/movil/indicadores";
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
const $m = (n: number) => `$ ${(n / 1e6).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;
const pc = (x: number | null) => (x == null ? "—" : `${(x * 100).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

// Inicio v2 (Diego 28/10/2026, mock_inicio_v2): sin switch. El mes en curso se proyecta solo;
// un mes pasado es real, y si le quedó algo sin cargar se suma (cartel ámbar). Resultado con
// rentabilidad, chips Food cost · Personal · Mix vs el mes anterior, promedio mensual del año,
// deuda y sin carga en una línea, y deslizar en cualquier parte cambia de mes.
function Inicio({ localId, pdvId, irImpagas, irSinCarga }: { localId: number; pdvId: number; irImpagas: () => void; irSinCarga: () => void }) {
  const ahora = new Date();
  const [ym, setYm] = useState({ anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 });
  const mover = (d: number) => setYm((x) => { let m = x.mes + d, a = x.anio; if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; } return { anio: a, mes: m }; });
  const clave = `${ym.anio}-${String(ym.mes).padStart(2, "0")}`;
  const url = (a: number, m: number) => `/api/m/resumen?localId=${localId}&pdvId=${pdvId}&anio=${a}&mes=${m}`;
  const { data, isLoading } = useFetchQuery<Resumen>(["m-resumen", localId, pdvId, ym.anio, ym.mes], url(ym.anio, ym.mes));
  const { data: imp } = useFetchQuery<ImpagasResponse>(["impagas", pdvId, null], `/api/impagas?pdvId=${pdvId}`);
  const { data: pr } = useFetchQuery<{ proyeccion: ProyeccionMes | null }>(
    ["proyeccion-ingresos", ym.anio, localId, pdvId], `/api/dashboard/proyeccion?year=${ym.anio}&localId=${localId}&pdvId=${pdvId}`, { staleTime: 5 * 60_000 });
  const proy = pr?.proyeccion && pr.proyeccion.anio === ym.anio && pr.proyeccion.mes === ym.mes ? pr.proyeccion : null;
  const { data: sc } = useFetchQuery<{ meses: MesSinCarga[] }>(["sin-carga", pdvId], `/api/sin-carga?pdvId=${pdvId}`, { staleTime: 60_000 });
  const scActual = sc?.meses[0];
  const scActualTot = scActual ? totales(scActual.items, false) : null;
  const scMes = sc?.meses.find((m) => m.mes === clave);
  // Los 3 meses anteriores: el anterior para los chips; los tres para el promedio por rubro de la proyección.
  const previos = [1, 2, 3].map((k) => { const t = ym.anio * 12 + (ym.mes - 1) - k; return { anio: Math.floor(t / 12), mes: (t % 12) + 1 }; });
  const h1 = useFetchQuery<Resumen>(["m-resumen", localId, pdvId, previos[0].anio, previos[0].mes], url(previos[0].anio, previos[0].mes));
  const h2 = useFetchQuery<Resumen>(["m-resumen", localId, pdvId, previos[1].anio, previos[1].mes], proy ? url(previos[1].anio, previos[1].mes) : null);
  const h3 = useFetchQuery<Resumen>(["m-resumen", localId, pdvId, previos[2].anio, previos[2].mes], proy ? url(previos[2].anio, previos[2].mes) : null);
  const historia = [h1.data, h2.data, h3.data].filter((x): x is Resumen => !!x && x.ventas > 0);
  const { data: anual } = useFetchQuery<{ meses: { mes: number; ventas: number; rubros: { rubro: string; total: number }[] }[] }>(
    ["m-anual", localId, pdvId, ym.anio], `/api/m/anual?localId=${localId}&pdvId=${pdvId}&anio=${ym.anio}`, { staleTime: 10 * 60_000 });

  // Modo del mes: proyección (en curso), real + sin cargar (pasado con faltantes) o real.
  const sinCargarMes = scMes ? totales(scMes.items, true) : null;
  const vista = (() => {
    if (!data) return null;
    if (proy && scMes) {
      const g = proyectarGastos({ cargado: data.rubros, sinCargar: scMes.items, historia, ventasProy: proy.proyeccion });
      return { modo: "proy" as const, ventas: proy.proyeccion, rubros: g.rubros.map((r) => ({ rubro: r.rubro, total: r.total })), gastosReal: data.gastos, faltan: sinCargarMes?.n ?? 0 };
    }
    if (sinCargarMes && sinCargarMes.total > 0.5) {
      const g = proyectarGastos({ cargado: data.rubros, sinCargar: scMes!.items, historia: [], ventasProy: data.ventas });
      return { modo: "falta" as const, ventas: data.ventas, rubros: g.rubros.map((r) => ({ rubro: r.rubro, total: r.total })), gastosReal: data.gastos, faltan: sinCargarMes.n, faltaTotal: sinCargarMes.total };
    }
    return { modo: "real" as const, ventas: data.ventas, rubros: data.rubros, gastosReal: data.gastos, faltan: 0 };
  })();
  const ind = vista ? indicadores(vista.ventas, vista.rubros) : null;
  const indAnt = h1.data ? indicadores(h1.data.ventas, h1.data.rubros) : null;
  const mesAnt = MESES[previos[0].mes - 1].slice(0, 3).toLowerCase();
  // Promedio mensual del año: meses cerrados (antes del mes en curso).
  const hoyClave = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;
  const cerrados = (anual?.meses ?? []).filter((m) => `${ym.anio}-${String(m.mes).padStart(2, "0")}` < hoyClave);
  const prom = promedioMensual(cerrados);
  const conVentas = cerrados.filter((m) => m.ventas > 0);
  const deuda = useMemo(() => {
    if (!imp) return null;
    const { impagas } = separar(imp.data);
    return { saldo: impagas.reduce((s, f) => s + saldo(f), 0), n: impagas.length };
  }, [imp]);

  // Deslizar en cualquier parte: ← mes siguiente · → mes anterior.
  const toque = useRef<{ x: number; y: number } | null>(null);
  const pctIng = (n: number) => (ind && ind.ventas > 0 ? pc(n / ind.ventas) : "—");
  const proyectado = vista && vista.modo !== "real";
  return (
    <div className="touch-pan-y"
      onTouchStart={(e) => { const t = e.touches[0]; toque.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={(e) => {
        const s = toque.current; toque.current = null; if (!s) return;
        const t = e.changedTouches[0]; const dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) mover(dx < 0 ? 1 : -1);
      }}>
      <Actualizado localId={localId} pdvId={pdvId} />
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={() => mover(-1)} className="size-10 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center"><ChevronLeft className="size-5" /></button>
        <div className="flex-1 text-center font-bold">{MESES[ym.mes - 1]} {ym.anio}</div>
        <button type="button" onClick={() => mover(1)} className="size-10 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center"><ChevronRight className="size-5" /></button>
      </div>
      {vista?.modo === "proy" && proy && (
        <div className="mb-2.5 text-center"><span className="rounded-full bg-sky-50 dark:bg-sky-950/50 px-3 py-1 text-[11.5px] font-bold text-sky-700 dark:text-sky-300">PROYECCIÓN al cierre · faltan {proy.diasRestantes} día{proy.diasRestantes === 1 ? "" : "s"}</span></div>
      )}
      {vista?.modo === "falta" && (
        <div className="mb-2.5 text-center"><button type="button" onClick={irSinCarga} className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-3 py-1 text-[11.5px] font-bold text-amber-700">REAL + {vista.faltan} sin cargar ({$m(vista.faltaTotal ?? 0)}) ›</button></div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi t="Ventas" v={isLoading || !vista ? "…" : $(vista.ventas)} proy={vista?.modo === "proy"}
          sub={vista?.modo === "proy" && proy ? `real ${$m(proy.facturado)}${proy.backtest ? ` · ±${Math.round(proy.backtest.errorMetodo * 100)}%` : ""}` : undefined} />
        <Kpi t="Gastos" v={isLoading || !ind ? "…" : $(ind.gastos)} proy={!!proyectado}
          sub={proyectado && vista ? `real ${$m(vista.gastosReal)}${vista.faltan ? ` · faltan cargar ${vista.faltan}` : ""}` : undefined} />
        <div className="col-span-2 flex items-baseline rounded-2xl border border-zinc-200 dark:border-zinc-700 px-3 py-2.5">
          <div><div className="text-[11.5px] text-zinc-500">Resultado</div>
            <b className={cn("text-[17px] tabular-nums", ind && (ind.resultado >= 0 ? "text-emerald-700" : "text-red-600"))}>{ind ? $(ind.resultado) : "…"}</b></div>
          <div className="ml-auto text-right"><div className="text-[11.5px] text-zinc-500">Rentabilidad</div>
            <b className={cn("text-[17px] tabular-nums", ind?.rentabilidad != null && (ind.rentabilidad >= 0 ? "text-emerald-700" : "text-red-600"))}>{pc(ind?.rentabilidad ?? null)}</b></div>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {([["Food cost", "foodCost"], ["Personal", "personal"], ["Mix", "mix"]] as const).map(([t, k], i) => {
          const d = difPp(ind?.[k] ?? null, indAnt?.[k] ?? null);
          return (
            <div key={k} className="rounded-2xl border border-zinc-200 dark:border-zinc-700 px-2.5 py-2">
              <div className="text-[11px] text-zinc-500">{t}</div>
              <b className="block text-[16px] tabular-nums">{pc(ind?.[k] ?? null)}</b>
              {d != null && Math.abs(d) >= 0.05 && (
                <div className={cn("text-[11px] font-bold leading-snug", d < 0 ? "text-emerald-700" : "text-red-600")}>
                  {d < 0 ? "▼" : "▲"} {Math.abs(d).toLocaleString("es-AR", { maximumFractionDigits: 1 })} pp{i === 0 ? ` vs ${mesAnt}` : ""}
                  {/* Cuánto es en plata (Diego 28/10): los puntos de diferencia sobre las ventas de este mes. */}
                  {ind && ind.ventas > 0 && <span className="block font-semibold">{d < 0 ? `ahorro ${$m(Math.abs(d) / 100 * ind.ventas)}` : `${$m(d / 100 * ind.ventas)} de más`}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={irImpagas} className="rounded-2xl border border-zinc-200 dark:border-zinc-700 px-3 py-2.5 text-left">
          <div className="flex justify-between text-[11.5px] text-zinc-500"><span>Deuda proveedores</span><span className="text-sky-700">›</span></div>
          <b className="block text-[17px] tabular-nums">{deuda ? $m(deuda.saldo) : "…"}</b>
          {deuda && <div className="text-[11px] text-zinc-500">{deuda.n} impaga{deuda.n === 1 ? "" : "s"}</div>}
        </button>
        <button type="button" onClick={irSinCarga} className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2.5 text-left">
          <div className="flex justify-between text-[11.5px] text-zinc-500"><span>Sin carga{scActual ? ` · ${MESES[Number(scActual.mes.slice(5)) - 1].slice(0, 3).toLowerCase()}` : ""}</span><span className="text-sky-700">›</span></div>
          <b className="block text-[17px] tabular-nums">{scActualTot ? $m(scActualTot.total) : "…"}</b>
          {scActualTot && <div className="text-[11px] text-zinc-500">{scActualTot.n ? `${scActualTot.n} gasto${scActualTot.n === 1 ? "" : "s"}` : "todo cargado"}</div>}
        </button>
      </div>
      {prom && (
        <div className="mt-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 px-3 py-2.5 text-[13px]">
          <b className="text-[13.5px]">Promedio mensual {ym.anio}</b>{" "}
          <span className="text-zinc-400">({MESES[conVentas[0].mes - 1].slice(0, 3).toLowerCase()}–{MESES[conVentas[conVentas.length - 1].mes - 1].slice(0, 3).toLowerCase()})</span>
          <div className="mt-1 flex justify-between"><span>Ventas</span><b className="tabular-nums">{$m(prom.ventas)}</b></div>
          <div className="flex justify-between"><span>Gastos</span><b className="tabular-nums">{$m(prom.gastos)}</b></div>
          <div className="flex justify-between"><span>Resultado · rentabilidad</span><b className="tabular-nums">{$m(prom.resultado)} · {pc(prom.rentabilidad)}</b></div>
          <div className="flex justify-between"><span>Food cost · Personal · Mix</span><b className="tabular-nums">{pc(prom.foodCost)} · {pc(prom.personal)} · {pc(prom.mix)}</b></div>
        </div>
      )}
      <div className="mt-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="flex items-baseline justify-between"><b>Gastos del mes por rubro{vista?.modo === "proy" ? " · proyectado" : vista?.modo === "falta" ? " · con lo sin cargar" : ""}</b><span className="text-[11.5px] text-zinc-500">% ing</span></div>
        {(vista?.rubros ?? []).map((r) => (
          <div key={r.rubro} className="flex items-baseline gap-2 border-b border-zinc-100 dark:border-zinc-800 py-2 last:border-0 text-[14px]">
            <span className="min-w-0 flex-1 truncate">{r.rubro}</span>
            <b className={cn("tabular-nums", proyectado && "text-sky-700 dark:text-sky-300")}>{$(r.total)}</b>
            <span className="w-12 shrink-0 text-right text-[12.5px] tabular-nums text-zinc-500">{pctIng(r.total)}</span>
          </div>
        ))}
        {vista && !vista.rubros.length && <p className="pt-2 text-[13px] text-zinc-500">Sin gastos en el mes.</p>}
      </div>
      <p className="mt-2 text-center text-[11.5px] text-zinc-400">← deslizá para cambiar de mes →</p>
      <Link href="/dashboard?completa=1" className="mt-3 block text-center text-[13px] text-sky-700 underline">Abrir el Panel completo</Link>
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

function Kpi({ t, v, cls, sub, proy }: { t: string; v: string; cls?: string; sub?: string; proy?: boolean }) {
  return (
    <div className={cn("rounded-2xl border px-3 py-2.5", proy ? "border-[#5BC2EA] bg-[#5BC2EA]/10" : "border-zinc-200 dark:border-zinc-700")}>
      <div className="text-[11.5px] text-zinc-500">{t}</div>
      <b className={cn("block text-[17px] tabular-nums", proy && "text-sky-700 dark:text-sky-300", cls)}>{v}</b>
      {sub && <div className="text-[11px] leading-snug text-zinc-500">{sub}</div>}
    </div>
  );
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
