"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Camera, ChevronLeft, ChevronRight, CircleDot, ClipboardList, Home, PenLine, Plus, Receipt } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import type { Local } from "@/lib/types/domain";
import { agrupar, separar, saldo, type ComprobanteImpago, type ImpagasResponse } from "@/lib/impagas/clasificar";
import { leerQrArca, type DatosQr } from "@/lib/movil/qr-arca";
import { leerQrDeArchivo } from "./leer-qr";
import type { ProyeccionMes } from "@/lib/dashboard/proyeccion";
import { frescura, hoyArgentina, type Frescura } from "@/lib/dashboard/frescura";
import { proyectarGastos } from "@/lib/movil/proyeccion-gastos";
import { cargadasDe, esPersonal, lineasRubro } from "@/lib/movil/rubro-detalle";
import { difPp, indicadores, promedioMensual } from "@/lib/movil/indicadores";
import { serieIndicador, sentido, INFO_INDICADOR, type ClaveIndicador } from "@/lib/movil/evolucion";
import { claveDescarte, sinElGasto, totales, type ItemSinCarga, type MesSinCarga } from "@/lib/sin-carga/estado";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { HttpError, REINTENTOS } from "@/lib/query-retry";
import { etiquetaSeleccion, sumarAnual, sumarProyeccion, sumarResumen, unirSinCarga } from "@/lib/movil/multi";
import { toast } from "sonner";
import { nombrePeriodo } from "@/lib/gastos-varios/periodo";
import { FacturaMovil } from "./factura-movil";
import { GastoMovil } from "./gasto-movil";
import { FacturaVerMovil } from "./factura-ver-movil";

// Lazarillo en el celular (Diego 27/10/2026): ver el mes, cargar facturas (con el QR
// de ARCA de la foto) y ver lo que se debe. Mismo login y mismos datos que el Panel.

// Abajo: Inicio · Cargar · Impagas · Sin carga (Diego 28/10: "Actividad en el celu no tiene sentido").
type Tab = "inicio" | "cargar" | "impagas" | "sincarga";
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const $ = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");
const LS_PDV = "movil:pdv";

function leerPdv(): { localId: number; pdvId: number } | null {
  try { const v = JSON.parse(localStorage.getItem(LS_PDV) ?? "null"); return v?.pdvId ? v : null; } catch { return null; }
}

type Carga = { qr: DatosQr | null } | { gasto: true } | { sc: ItemSinCarga; mes: string } | null;
type Sel = { localId: number; pdvId: number };
const LS_PDVS = "movil:pdvs";

function leerPdvs(): number[] | null {
  try { const v = JSON.parse(localStorage.getItem(LS_PDVS) ?? "null"); return Array.isArray(v) && v.length ? v.map(Number) : null; } catch { return null; }
}

// Una misma consulta para cada PDV elegido (misma clave que con uno solo: comparte caché). `list`
// llega cuando están todas (Diego 29/10: ver varios PDV juntos).
function useMulti<T>(sel: Sel[], key: (s: Sel) => unknown[], url: (s: Sel) => string | null, staleTime = 30_000) {
  const qs = useQueries({
    queries: sel.map((s) => {
      const u = url(s);
      return {
        queryKey: key(s),
        queryFn: async () => { const r = await fetch(u!); if (!r.ok) throw new HttpError(r.status); return r.json() as Promise<T>; },
        enabled: u !== null, staleTime, ...REINTENTOS,
      };
    }),
  });
  const listo = qs.length > 0 && qs.every((q) => q.data !== undefined);
  return { list: listo ? qs.map((q) => q.data as T) : undefined, isLoading: qs.some((q) => q.isLoading), isError: qs.some((q) => q.isError) };
}

export function AppMovil() {
  const [tab, setTabCrudo] = useState<Tab>("inicio");
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const pdvs = useMemo(() => (locales ?? []).flatMap((l) => l.puntosDeVenta.map((p) => ({ localId: l.id, pdvId: p.id, label: `${l.nombre} · ${p.nombre}` }))), [locales]);
  // Los PDV elegidos se recuerdan en el celular (Diego 29/10: varios a la vez). Inicio suma todos;
  // Cargar / Impagas / Sin carga trabajan sobre uno (el "actual", que se elige entre los tildados).
  const [selIds, setSelIds] = useState<number[] | null>(() => {
    if (typeof window === "undefined") return null;
    const v = leerPdvs(); if (v) return v;
    const uno = leerPdv(); return uno ? [uno.pdvId] : null;
  });
  const elegidos = useMemo(() => { const e = pdvs.filter((p) => selIds?.includes(p.pdvId)); return e.length ? e : pdvs.slice(0, 1); }, [pdvs, selIds]);
  const [actualId, setActualId] = useState<number | null>(null);
  const actual = elegidos.find((p) => p.pdvId === actualId) ?? elegidos[0] ?? null;
  const [eligiendo, setEligiendo] = useState(false);
  const guardarSeleccion = (ids: number[]) => {
    setSelIds(ids); setActualId(null); setEligiendo(false);
    try {
      localStorage.setItem(LS_PDVS, JSON.stringify(ids));
      const p = pdvs.find((x) => x.pdvId === ids[0]);
      if (p) localStorage.setItem(LS_PDV, JSON.stringify({ localId: p.localId, pdvId: p.pdvId }));
    } catch { /* sin almacenamiento */ }
  };

  // Carga
  // Mes con el que se abre "Sin carga": el que se está mirando en Inicio (Diego 28/10).
  const [mesSc, setMesSc] = useState<string | null>(null);
  const [carga, setCargaCruda] = useState<Carga>(null);
  // Volver (Diego 28/10): deslizar → (salvo en Inicio, donde cambia el mes) o el botón Volver
  // regresan a la pantalla anterior. Cada navegación guarda dónde estaba.
  const historial = useRef<{ tab: Tab; carga: Carga }[]>([]);
  const [hayAtras, setHayAtras] = useState(false);
  const volverLocalRef = useRef<(() => boolean) | null>(null); // una pantalla con detalle propio (factura en Impagas)
  const ir = (t: Tab, c: Carga = null) => {
    historial.current.push({ tab, carga });
    setHayAtras(true);
    setTabCrudo(t); setCargaCruda(c);
  };
  const setTab = (t: Tab) => ir(t, t === "cargar" ? carga : null);
  const setCarga = (c: Carga) => ir(c ? "cargar" : tab, c);
  function atras() {
    if (volverLocalRef.current?.()) return;
    const prev = historial.current.pop();
    setHayAtras(historial.current.length > 0);
    if (prev) { setTabCrudo(prev.tab); setCargaCruda(prev.carga); return; }
    if (tab !== "inicio" || carga) { setTabCrudo("inicio"); setCargaCruda(null); }
  }
  const toque = useRef<{ x: number; y: number } | null>(null);
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

  const titulos: Record<Tab, string> = { inicio: "Inicio", cargar: carga ? ("gasto" in carga || ("sc" in carga && !carga.sc.proveedorId) ? "Gasto vario" : "Factura") : "Cargar", impagas: "Impagas", sincarga: "Sin carga" };
  const enInicio = tab === "inicio" && !carga;

  return (
    <div className="flex min-h-svh flex-col bg-white dark:bg-zinc-950">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 px-4 py-3 backdrop-blur">
        {!enInicio && (hayAtras || tab !== "inicio") && (
          <button type="button" onClick={atras} aria-label="Volver" className="-ml-2 flex items-center text-sky-700"><ChevronLeft className="size-6" /></button>
        )}
        <b className="text-[19px]">{titulos[tab]}</b>
        {pdvs.length > 0 && (enInicio || elegidos.length === 1 ? (
          <button type="button" onClick={() => setEligiendo(true)}
            className="ml-auto max-w-[62%] truncate rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-[13px]">
            {etiquetaSeleccion(locales ?? [], elegidos.map((p) => p.pdvId))} ▾
          </button>
        ) : (
          // Fuera de Inicio, con varios tildados: en cuál se trabaja.
          <select value={actual?.pdvId ?? ""} onChange={(e) => setActualId(Number(e.target.value))}
            className="ml-auto max-w-[60%] truncate rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-[13px]">
            {elegidos.map((p) => <option key={p.pdvId} value={p.pdvId}>{p.label}</option>)}
          </select>
        ))}
      </header>

      <main className="flex-1 px-4 pt-3 pb-24 touch-pan-y"
        onTouchStart={(e) => {
          // Las filas que se deslizan (Sin carga) tienen su propia acción: no es "volver".
          const t = e.touches[0];
          toque.current = enInicio || (e.target as HTMLElement).closest("[data-deslizable]") ? null : { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const s = toque.current; toque.current = null; if (!s) return;
          const t = e.changedTouches[0]; const dx = t.clientX - s.x, dy = t.clientY - s.y;
          if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) atras();
        }}>
        {!actual ? <p className="py-10 text-center text-zinc-500">Cargando…</p>
          : tab === "inicio" ? <Inicio sel={elegidos.map((p) => ({ localId: p.localId, pdvId: p.pdvId }))} irImpagas={() => setTab("impagas")} irSinCarga={(mes) => { setMesSc(mes); setTab("sincarga"); }} />
          : tab === "sincarga" ? <SinCarga pdvId={actual.pdvId} mesInicial={mesSc} nombrePdv={(id) => pdvs.find((p) => p.pdvId === id)?.label ?? "otro PDV"} onCargar={(sc, mes) => ir("cargar", { sc, mes })} />
          : tab === "impagas" ? <Impagas pdvId={actual.pdvId} volverLocalRef={volverLocalRef} />
          : carga && "sc" in carga ? (() => {
            // Lo que llega por apertura se carga en su PDV de origen, por el importe entero.
            const o = pdvs.find((p) => p.pdvId === carga.sc.pdvOrigenId) ?? actual;
            return carga.sc.proveedorId
              ? <FacturaMovil key={carga.sc.clave} qr={null} proveedorId={carga.sc.proveedorId} localId={o.localId} pdvId={o.pdvId} onCerrar={atras} />
              : <GastoMovil key={carga.sc.clave} pdvId={o.pdvId} inicial={{ conceptoCodigo: carga.sc.conceptoCodigo, periodo: carga.mes, importe: carga.sc.ultimoTotal }} onCerrar={atras} />;
          })()
          : carga && "gasto" in carga ? <GastoMovil key={actual.pdvId} pdvId={actual.pdvId} onCerrar={atras} />
          : carga ? <FacturaMovil key={JSON.stringify(carga.qr)} qr={carga.qr} localId={actual.localId} pdvId={actual.pdvId} onCerrar={atras} />
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
      {eligiendo && <ElegirPdvs locales={locales ?? []} inicial={elegidos.map((p) => p.pdvId)} onListo={guardarSeleccion} onCerrar={() => setEligiendo(false)} />}

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
        {([["inicio", Home, "Inicio"], ["cargar", Plus, "Cargar"], ["impagas", CircleDot, "Impagas"], ["sincarga", ClipboardList, "Sin carga"]] as const).map(([k, Icono, t]) => (
          <button key={k} type="button" onClick={() => { if (k === "sincarga") setMesSc(null); ir(k, null); }}
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
function Inicio({ sel, irImpagas, irSinCarga }: { sel: Sel[]; irImpagas: () => void; irSinCarga: (mes: string | null) => void }) {
  // El primero, para lo que es de un PDV (la fecha de actualización).
  const { localId, pdvId } = sel[0];
  const ahora = new Date();
  const [ym, setYm] = useState({ anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 });
  const mover = (d: number) => setYm((x) => { let m = x.mes + d, a = x.anio; if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; } return { anio: a, mes: m }; });
  const clave = `${ym.anio}-${String(ym.mes).padStart(2, "0")}`;
  // Cada consulta va por PDV y se suma (varios PDV juntos, Diego 29/10).
  const url = (s: Sel, a: number, m: number) => `/api/m/resumen?localId=${s.localId}&pdvId=${s.pdvId}&anio=${a}&mes=${m}`;
  const res = useMulti<Resumen>(sel, (s) => ["m-resumen", s.localId, s.pdvId, ym.anio, ym.mes], (s) => url(s, ym.anio, ym.mes));
  const data = res.list ? sumarResumen(res.list) : undefined;
  const isLoading = res.isLoading;
  const imps = useMulti<ImpagasResponse>(sel, (s) => ["impagas", s.pdvId, null], (s) => `/api/impagas?pdvId=${s.pdvId}`).list;
  const prs = useMulti<{ proyeccion: ProyeccionMes | null }>(sel, (s) => ["proyeccion-ingresos", ym.anio, s.localId, s.pdvId],
    (s) => `/api/dashboard/proyeccion?year=${ym.anio}&localId=${s.localId}&pdvId=${s.pdvId}`, 5 * 60_000).list;
  const prSum = prs ? sumarProyeccion(prs.map((x) => x.proyeccion)) : null;
  const proy = prSum && prSum.anio === ym.anio && prSum.mes === ym.mes ? prSum : null;
  const scs = useMulti<{ meses: MesSinCarga[] }>(sel, (s) => ["sin-carga", s.pdvId], (s) => `/api/sin-carga?pdvId=${s.pdvId}`, 60_000).list;
  const sc = scs ? unirSinCarga(scs) : undefined;
  const scActual = sc?.meses.find((m) => m.mes === clave) ?? sc?.meses[0]; // el mes que se mira (Diego 28/10)
  const scActualTot = scActual ? totales(scActual.items, false) : null;
  const scMes = sc?.meses.find((m) => m.mes === clave);
  // Los 3 meses anteriores: el anterior para los chips; los tres para el promedio por rubro de la proyección.
  const previos = [1, 2, 3].map((k) => { const t = ym.anio * 12 + (ym.mes - 1) - k; return { anio: Math.floor(t / 12), mes: (t % 12) + 1 }; });
  const h1l = useMulti<Resumen>(sel, (s) => ["m-resumen", s.localId, s.pdvId, previos[0].anio, previos[0].mes], (s) => url(s, previos[0].anio, previos[0].mes)).list;
  const h2l = useMulti<Resumen>(sel, (s) => ["m-resumen", s.localId, s.pdvId, previos[1].anio, previos[1].mes], (s) => (proy ? url(s, previos[1].anio, previos[1].mes) : null)).list;
  const h3l = useMulti<Resumen>(sel, (s) => ["m-resumen", s.localId, s.pdvId, previos[2].anio, previos[2].mes], (s) => (proy ? url(s, previos[2].anio, previos[2].mes) : null)).list;
  const h1 = { data: h1l ? sumarResumen(h1l) : undefined };
  const historia = [h1l, h2l, h3l].map((l) => (l ? sumarResumen(l) : undefined)).filter((x): x is Resumen => !!x && x.ventas > 0);
  type Anual = { meses: { mes: number; ventas: number; rubros: { rubro: string; total: number }[] }[] };
  const anuales = useMulti<Anual>(sel, (s) => ["m-anual", s.localId, s.pdvId, ym.anio], (s) => `/api/m/anual?localId=${s.localId}&pdvId=${s.pdvId}&anio=${ym.anio}`, 10 * 60_000).list;
  const anual = anuales ? sumarAnual(anuales) : undefined;

  // Modo del mes: proyección (en curso), real + sin cargar (pasado con faltantes) o real.
  const sinCargarMes = scMes ? totales(scMes.items, true) : null;
  const vista = (() => {
    if (!data) return null;
    if (proy && scMes) {
      const g = proyectarGastos({ cargado: data.rubros, sinCargar: scMes.items, historia, ventasProy: proy.proyeccion });
      return { modo: "proy" as const, ventas: proy.proyeccion, rubros: g.rubros.map((r) => ({ rubro: r.rubro, total: r.total, variable: r.variable })), gastosReal: data.gastos, faltan: sinCargarMes?.n ?? 0 };
    }
    if (sinCargarMes && sinCargarMes.total > 0.5) {
      const g = proyectarGastos({ cargado: data.rubros, sinCargar: scMes!.items, historia: [], ventasProy: data.ventas });
      return { modo: "falta" as const, ventas: data.ventas, rubros: g.rubros.map((r) => ({ rubro: r.rubro, total: r.total, variable: r.variable })), gastosReal: data.gastos, faltan: sinCargarMes.n, faltaTotal: sinCargarMes.total };
    }
    return { modo: "real" as const, ventas: data.ventas, rubros: data.rubros.map((r) => ({ rubro: r.rubro, total: r.total, variable: 0 })), gastosReal: data.gastos, faltan: 0 };
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
    if (!imps) return null;
    const impagas = imps.flatMap((imp) => separar(imp.data).impagas);
    return { saldo: impagas.reduce((s, f) => s + saldo(f), 0), n: impagas.length };
  }, [imps]);

  // Deslizar en cualquier parte: ← mes siguiente · → mes anterior.
  const toque = useRef<{ x: number; y: number } | null>(null);
  const pctIng = (n: number) => (ind && ind.ventas > 0 ? pc(n / ind.ventas) : "—");
  const proyectado = vista && vista.modo !== "real";
  // Evolución del indicador al tocar su tarjeta (Diego 29/10: Food cost / Personal / Mix, y después todas).
  const [evolucion, setEvolucion] = useState<ClaveIndicador | null>(null);
  // Rubro desplegado en "Gastos del mes por rubro" (Diego 29/10); se cierra al cambiar de mes.
  const [abiertoEn, setAbiertoEn] = useState<{ clave: string; rubro: string } | null>(null);
  const abierto = abiertoEn?.clave === clave ? abiertoEn.rubro : null;
  return (
    <div className="touch-pan-y"
      onTouchStart={(e) => { const t = e.touches[0]; toque.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={(e) => {
        const s = toque.current; toque.current = null; if (!s) return;
        const t = e.changedTouches[0]; const dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) mover(dx < 0 ? 1 : -1);
      }}>
      <Actualizado localId={localId} pdvId={pdvId} />
      {/* Selector de mes fijo debajo del encabezado al scrollear (Diego 29/10). */}
      <div className="sticky top-[56px] z-10 -mx-4 mb-2 flex items-center gap-2 bg-white/95 dark:bg-zinc-950/95 px-4 py-1.5 backdrop-blur">
        <button type="button" onClick={() => mover(-1)} className="size-10 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center"><ChevronLeft className="size-5" /></button>
        <div className="flex-1 text-center font-bold">{MESES[ym.mes - 1]} {ym.anio}</div>
        <button type="button" onClick={() => mover(1)} className="size-10 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center"><ChevronRight className="size-5" /></button>
      </div>
      {vista?.modo === "proy" && proy && (
        <div className="mb-2.5 text-center"><span className="rounded-full bg-sky-50 dark:bg-sky-950/50 px-3 py-1 text-[11.5px] font-bold text-sky-700 dark:text-sky-300">PROYECCIÓN al cierre · faltan {proy.diasRestantes} día{proy.diasRestantes === 1 ? "" : "s"}</span></div>
      )}
      {vista?.modo === "falta" && (
        <div className="mb-2.5 text-center"><button type="button" onClick={() => irSinCarga(clave)} className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-3 py-1 text-[11.5px] font-bold text-amber-700">REAL + {vista.faltan} sin cargar ({$m(vista.faltaTotal ?? 0)}) ›</button></div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Todas las tarjetas abren su evolución (Diego 29/10/2026). */}
        <Kpi t="Ventas" v={isLoading || !vista ? "…" : $(vista.ventas)} proy={vista?.modo === "proy"} onClick={() => setEvolucion("ventas")}
          sub={vista?.modo === "proy" && proy ? `real ${$m(proy.facturado)}${proy.backtest ? ` · ±${Math.round(proy.backtest.errorMetodo * 100)}%` : ""}` : undefined} />
        <Kpi t="Gastos" v={isLoading || !ind ? "…" : $(ind.gastos)} proy={!!proyectado} onClick={() => setEvolucion("gastos")}
          sub={proyectado && vista ? `real ${$m(vista.gastosReal)}${vista.faltan ? ` · faltan cargar ${vista.faltan}` : ""}` : undefined} />
        <div className="col-span-2 flex items-baseline rounded-2xl border border-zinc-200 dark:border-zinc-700">
          <button type="button" onClick={() => setEvolucion("resultado")} className="flex-1 rounded-l-2xl px-3 py-2.5 text-left active:bg-zinc-50 dark:active:bg-zinc-800"><div className="text-[11.5px] text-zinc-500">Resultado</div>
            <b className={cn("text-[17px] tabular-nums", ind && (ind.resultado >= 0 ? "text-emerald-700" : "text-red-600"))}>{ind ? $(ind.resultado) : "…"}</b></button>
          <button type="button" onClick={() => setEvolucion("rentabilidad")} className="flex-1 rounded-r-2xl px-3 py-2.5 text-right active:bg-zinc-50 dark:active:bg-zinc-800"><div className="text-[11.5px] text-zinc-500">Rentabilidad</div>
            <b className={cn("text-[17px] tabular-nums", ind?.rentabilidad != null && (ind.rentabilidad >= 0 ? "text-emerald-700" : "text-red-600"))}>{pc(ind?.rentabilidad ?? null)}</b></button>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {([["Food cost", "foodCost"], ["Personal", "personal"], ["Mix", "mix"]] as const).map(([t, k], i) => {
          const d = difPp(ind?.[k] ?? null, indAnt?.[k] ?? null);
          return (
            <button type="button" key={k} onClick={() => setEvolucion(k)} className="rounded-2xl border border-zinc-200 dark:border-zinc-700 px-2.5 py-2 text-left active:bg-zinc-50">
              <div className="text-[11px] text-zinc-500">{t}</div>
              <b className="block text-[16px] tabular-nums">{pc(ind?.[k] ?? null)}</b>
              {d != null && Math.abs(d) >= 0.05 && (
                <div className={cn("text-[11px] font-bold leading-snug", d < 0 ? "text-emerald-700" : "text-red-600")}>
                  {d < 0 ? "▼" : "▲"} {Math.abs(d).toLocaleString("es-AR", { maximumFractionDigits: 1 })} pp{i === 0 ? ` vs ${mesAnt}` : ""}
                  {/* Cuánto es en plata (Diego 28/10): los puntos de diferencia sobre las ventas de este mes. */}
                  {ind && ind.ventas > 0 && <span className="block font-semibold">{d < 0 ? `ahorro ${$m(Math.abs(d) / 100 * ind.ventas)}` : `${$m(d / 100 * ind.ventas)} de más`}</span>}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={irImpagas} className="rounded-2xl border border-zinc-200 dark:border-zinc-700 px-3 py-2.5 text-left">
          <div className="flex justify-between text-[11.5px] text-zinc-500"><span>Deuda proveedores</span><span className="text-sky-700">›</span></div>
          <b className="block text-[17px] tabular-nums">{deuda ? $m(deuda.saldo) : "…"}</b>
          {deuda && <div className="text-[11px] text-zinc-500">{deuda.n} impaga{deuda.n === 1 ? "" : "s"}</div>}
        </button>
        <button type="button" onClick={() => irSinCarga(scActual?.mes ?? null)} className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2.5 text-left">
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
        {[...(vista?.rubros ?? [])].sort((a, b) => b.total - a.total).map((r) => (
          <RubroMes key={r.rubro} rubro={r.rubro} total={r.total} estimado={r.variable}
            proyectado={!!proyectado} pctIng={pctIng} abierto={abierto === r.rubro} onToggle={() => setAbiertoEn(abierto === r.rubro ? null : { clave, rubro: r.rubro })}
            detalle={{ sel, anio: ym.anio, mes: ym.mes }} sinCargar={vista?.modo !== "real" ? (scMes?.items ?? []) : []} />
        ))}
        {vista && !vista.rubros.length && <p className="pt-2 text-[13px] text-zinc-500">Sin gastos en el mes.</p>}
      </div>
      <p className="mt-2 text-center text-[11.5px] text-zinc-400">← deslizá para cambiar de mes →</p>
      <Link href="/dashboard?completa=1" className="mt-3 block text-center text-[13px] text-sky-700 underline">Abrir el Panel completo</Link>
      {evolucion && (
        <Evolucion clave={evolucion} sel={sel} hasta={ym} anualActual={anual?.meses ?? []}
          actual={vista && vista.modo !== "real" ? { valor: ind?.[evolucion] ?? null, proyectado: vista.modo === "proy" } : null}
          onClose={() => setEvolucion(null)} />
      )}
    </div>
  );
}

// Evolución de un indicador (Diego 29/10/2026, mockup_celu_pdvs_indicadores): barras de los últimos
// 3 / 6 / 9 / 12 meses hasta el que se mira y la diferencia contra el mes anterior (puntos en los %,
// variación % en la plata). Verde/rojo según hacia dónde conviene que vaya.
const plataCorta = (n: number) => {
  const a = Math.abs(n), sg = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sg}${(a / 1e6).toLocaleString("es-AR", { maximumFractionDigits: a >= 1e8 ? 0 : 1 })}M`;
  return `${sg}${Math.round(a / 1e3).toLocaleString("es-AR")}k`;
};
function Evolucion({ clave, sel, hasta, anualActual, actual, onClose }: {
  clave: ClaveIndicador; sel: Sel[]; hasta: { anio: number; mes: number };
  anualActual: { mes: number; ventas: number; rubros: { rubro: string; total: number }[] }[];
  actual: { valor: number | null; proyectado: boolean } | null; onClose: () => void;
}) {
  const [n, setN] = useState(6);
  const ant = hasta.anio - 1;
  // El año anterior solo si la ventana lo necesita.
  const necesitaAnt = hasta.mes < n;
  const antes = useMulti<{ meses: { mes: number; ventas: number; rubros: { rubro: string; total: number }[] }[] }>(sel, (s) => ["m-anual", s.localId, s.pdvId, ant],
    (s) => (necesitaAnt ? `/api/m/anual?localId=${s.localId}&pdvId=${s.pdvId}&anio=${ant}` : null), 10 * 60_000).list;
  const anualAnt = antes ? sumarAnual(antes) : undefined;
  const serie = serieIndicador({
    meses: [...(anualAnt?.meses ?? []).map((m) => ({ ...m, anio: ant })), ...anualActual.map((m) => ({ ...m, anio: hasta.anio }))],
    clave, hasta, n, actual,
  });
  const info = INFO_INDICADOR[clave];
  const plata = info.tipo === "plata";
  const unidad = plata ? "%" : " pp";
  const vals = serie.map((x) => x.valor).filter((v): v is number => v != null);
  const min = vals.length ? Math.min(...vals) : 0, max = vals.length ? Math.max(...vals) : 1;
  // La barra más baja queda en 40%: se ven las diferencias sin exagerarlas.
  const alto = (v: number) => 40 + (max > min ? ((v - min) / (max - min)) * 60 : 40);
  const mesCorto = (m: number) => MESES[m - 1].slice(0, 3).toLowerCase();
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-white dark:bg-zinc-950" onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div className="sticky top-0 flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={onClose} aria-label="Volver" className="-ml-2 flex items-center text-sky-700"><ChevronLeft className="size-6" /></button>
        <b className="text-[19px]">{info.titulo}</b>
        <span className="ml-auto text-[12px] text-zinc-500">hasta {MESES[hasta.mes - 1]} {hasta.anio}</span>
      </div>
      <div className="px-4 pt-3 pb-10">
        <div className="inline-flex rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1">
          {[3, 6, 9, 12].map((k) => (
            <button key={k} type="button" onClick={() => setN(k)}
              className={cn("rounded-lg px-3.5 py-1 text-[13px] font-semibold", n === k ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-zinc-500")}>{k}</button>
          ))}
          <span className="self-center px-2 text-[12px] text-zinc-500">meses</span>
        </div>
        <div className="mt-5 flex h-44 items-end gap-1.5 border-b border-zinc-200 dark:border-zinc-700">
          {serie.map((x) => (
            <div key={`${x.anio}-${x.mes}`} className="flex h-full flex-1 flex-col items-center justify-end">
              {x.valor != null && <span className="mb-0.5 whitespace-nowrap text-[10px] tabular-nums text-zinc-600 dark:text-zinc-300">{plata ? plataCorta(x.valor) : `${(x.valor * 100).toLocaleString("es-AR", { maximumFractionDigits: n > 6 ? 0 : 1 })}%`}</span>}
              <div className={cn("w-full rounded-t-md", x.valor != null && x.valor < 0 ? "bg-red-400" : x.proyectado ? "bg-sky-500" : "bg-[#5BC2EA]")} style={{ height: x.valor != null ? `${alto(x.valor) * 0.8}%` : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          {serie.map((x) => <span key={`${x.anio}-${x.mes}`} className="flex-1 text-center text-[10.5px] text-zinc-500">{mesCorto(x.mes)}{x.proyectado ? "*" : ""}</span>)}
        </div>
        <div className="mt-4">
          {[...serie].reverse().map((x) => (
            <div key={`${x.anio}-${x.mes}`} className="flex items-baseline gap-2 border-b border-zinc-100 dark:border-zinc-800 py-2 text-[14px]">
              <span className="flex-1">{MESES[x.mes - 1]} {x.anio !== hasta.anio ? x.anio : ""}{x.proyectado && <span className="ml-1.5 text-[11.5px] text-zinc-500">proyectado</span>}</span>
              <b className={cn("text-right tabular-nums", plata ? "w-24" : "w-16")}>{plata ? (x.valor == null ? "—" : $m(x.valor)) : pc(x.valor)}</b>
              <span className={cn("w-20 text-right text-[12.5px] font-bold tabular-nums", { bueno: "text-emerald-700", malo: "text-red-600", nada: "text-zinc-400" }[sentido(clave, x.dif) ?? "nada"])}>
                {x.dif == null ? "—" : Math.abs(x.dif) < 0.05 ? "=" : `${x.dif > 0 ? "▲" : "▼"} ${Math.abs(x.dif).toLocaleString("es-AR", { maximumFractionDigits: 1 })}${unidad}`}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-zinc-500">{plata ? "% contra el mes anterior" : "pp = puntos contra el mes anterior"} · verde: mejora · rojo: empeora</p>
      </div>
    </div>
  );
}

// Un rubro de "Gastos del mes por rubro": tocándolo se despliega su detalle de mayor a menor
// (Diego 29/10/2026). Personal por empleado (vista Proveedor del Panel); el resto por insumo
// o concepto (vista Insumos). Se piden al abrir: un pivot del mes por agrupación, compartido.
function RubroMes({ rubro, total, estimado, proyectado, pctIng, abierto, onToggle, detalle, sinCargar }: {
  rubro: string; total: number; estimado: number; proyectado: boolean; pctIng: (n: number) => string;
  abierto: boolean; onToggle: () => void; detalle: { sel: Sel[]; anio: number; mes: number };
  sinCargar: ItemSinCarga[];
}) {
  const agrupacion = esPersonal(rubro) ? "proveedor" : "insumo";
  const { sel, anio, mes } = detalle;
  const piv = useMulti<{ rows: { nombre: string; rowTotal: number; children: { nombre: string; rowTotal: number }[] }[] }>(sel,
    (s) => ["m-rubro-detalle", s.localId, s.pdvId, anio, mes, agrupacion],
    (s) => (abierto ? `/api/dashboard/pivot?year=${anio}&localId=${s.localId}&pdvId=${s.pdvId}&months=${mes}&agrupacion=${agrupacion}` : null), 5 * 60_000);
  // Varios PDV: se juntan las filas; cargadasDe suma los repetidos.
  const data = piv.list ? { rows: piv.list.flatMap((x) => x.rows) } : undefined;
  const isLoading = abierto && !piv.list && !piv.isError, isError = piv.isError;
  const [todas, setTodas] = useState(false);
  const lineas = lineasRubro({ rubro, cargadas: cargadasDe(data?.rows, rubro), sinCargar, estimado });
  const MAX = 12;
  const vis = todas ? lineas : lineas.slice(0, MAX);
  const resto = lineas.slice(MAX);
  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <button type="button" onClick={onToggle} aria-expanded={abierto} className="flex w-full items-baseline gap-2 py-2 text-left text-[14px]">
        <ChevronRight className={cn("size-3.5 shrink-0 self-center text-zinc-400 transition-transform", abierto && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{rubro}</span>
        <b className={cn("tabular-nums", proyectado && "text-sky-700 dark:text-sky-300")}>{$(total)}</b>
        <span className="w-12 shrink-0 text-right text-[12.5px] tabular-nums text-zinc-500">{pctIng(total)}</span>
      </button>
      {abierto && (
        <div className="mb-2 ml-5 rounded-xl bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-[13px]">
          {isLoading && <p className="py-1.5 text-zinc-500">Cargando…</p>}
          {isError && <p className="py-1.5 text-red-600">No se pudo traer el detalle.</p>}
          {!isLoading && !isError && !lineas.length && <p className="py-1.5 text-zinc-500">Sin detalle.</p>}
          {vis.map((l, i) => (
            <div key={`${l.tipo}-${l.nombre}-${i}`} className="flex items-baseline gap-2 border-b border-zinc-100 dark:border-zinc-800 py-1.5 last:border-0">
              <span className="min-w-0 flex-1 truncate">{l.nombre}
                {l.nota && <span className={cn("ml-1.5 text-[11px] font-semibold", l.tipo === "sinCargar" ? "text-amber-600" : "text-sky-700 dark:text-sky-300")}>{l.nota}</span>}</span>
              <span className={cn("tabular-nums", l.tipo !== "cargado" && "text-zinc-500")}>{$(l.total)}</span>
            </div>
          ))}
          {!todas && resto.length > 0 && (
            <button type="button" onClick={() => setTodas(true)} className="w-full py-1.5 text-left text-[12.5px] text-sky-700">
              + {resto.length} más · {$(resto.reduce((s, l) => s + l.total, 0))}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Caja({ on }: { on: boolean }) {
  return <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] text-[12px] text-white", on ? "border-zinc-900 bg-zinc-900 dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300")}>{on ? "✓" : ""}</span>;
}

// Elegir qué PDV ver (Diego 29/10/2026, mockup_celu_pdvs_indicadores): se tildan por local, con atajos
// "Todo <local>" y "Todos los PDV". Inicio suma los elegidos.
function ElegirPdvs({ locales, inicial, onListo, onCerrar }: { locales: Local[]; inicial: number[]; onListo: (ids: number[]) => void; onCerrar: () => void }) {
  const [ids, setIds] = useState<number[]>(inicial);
  const todos = locales.flatMap((l) => l.puntosDeVenta.map((p) => p.id));
  const tiene = (id: number) => ids.includes(id);
  const alternar = (id: number) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const todosDe = (ls: number[]) => ls.length > 0 && ls.every(tiene);
  const fila = "flex w-full items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 py-2.5 text-left text-[15px]";
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onCerrar}>
      <div className="max-h-[85svh] w-full overflow-y-auto rounded-t-3xl bg-white dark:bg-zinc-950 px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300" />
        <b className="text-[16px]">Qué PDV ver</b>
        <div className="text-[12.5px] text-zinc-500">Se suman ventas, gastos e indicadores</div>
        {locales.map((l) => (
          <div key={l.id} className="mt-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{l.nombre}</div>
            {l.puntosDeVenta.map((p) => (
              <button key={p.id} type="button" className={fila} onClick={() => alternar(p.id)}><Caja on={tiene(p.id)} />{p.nombre}</button>
            ))}
          </div>
        ))}
        <div className="mt-3 text-[11px] font-bold uppercase tracking-wide text-zinc-500">Atajos</div>
        {locales.filter((l) => l.puntosDeVenta.length > 1).map((l) => {
          const de = l.puntosDeVenta.map((p) => p.id);
          return <button key={l.id} type="button" className={fila} onClick={() => setIds(de)}><Caja on={todosDe(de) && ids.length === de.length} />Todo {l.nombre}</button>;
        })}
        {todos.length > 1 && <button type="button" className={fila} onClick={() => setIds(todos)}><Caja on={todosDe(todos)} />Todos los PDV</button>}
        <button type="button" disabled={!ids.length} onClick={() => onListo(todos.filter((id) => ids.includes(id)))}
          className="mt-4 w-full rounded-2xl bg-zinc-900 py-3 text-[15px] font-bold text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900">
          {ids.length === 1 ? "Ver 1 PDV" : `Ver ${ids.length} PDV`}
        </button>
        <p className="mt-2 text-[12px] text-zinc-500">Cargar, Impagas y Sin carga siguen siendo de a un PDV: arriba elegís en cuál.</p>
      </div>
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

function Kpi({ t, v, cls, sub, proy, onClick }: { t: string; v: string; cls?: string; sub?: string; proy?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={cn("rounded-2xl border px-3 py-2.5 text-left active:bg-zinc-50 dark:active:bg-zinc-800", proy ? "border-[#5BC2EA] bg-[#5BC2EA]/10" : "border-zinc-200 dark:border-zinc-700")}>
      <div className="text-[11.5px] text-zinc-500">{t}</div>
      <b className={cn("block text-[17px] tabular-nums", proy && "text-sky-700 dark:text-sky-300", cls)}>{v}</b>
      {sub && <div className="text-[11px] leading-snug text-zinc-500">{sub}</div>}
    </button>
  );
}

function Impagas({ pdvId, volverLocalRef }: { pdvId: number; volverLocalRef: React.MutableRefObject<(() => boolean) | null> }) {
  const { data, isLoading } = useFetchQuery<ImpagasResponse>(["impagas", pdvId, null], `/api/impagas?pdvId=${pdvId}`);
  const grupos = useMemo(() => (data ? agrupar(separar(data.data).impagas, "saldo") : []), [data]);
  const [abierto, setAbierto] = useState<string | null>(null);
  // Tocar una factura la abre (Diego 28/10): renglones, total y pagos, solo lectura.
  const [ver, setVer] = useState<ComprobanteImpago | null>(null);
  // Volver (deslizar o el botón de arriba) cierra primero la factura abierta.
  useEffect(() => {
    volverLocalRef.current = ver ? () => { setVer(null); return true; } : null;
    return () => { volverLocalRef.current = null; };
  }, [ver, volverLocalRef]);
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
function SinCarga({ pdvId, mesInicial, onCargar, nombrePdv }: { pdvId: number; mesInicial: string | null; onCargar: (x: ItemSinCarga, mes: string) => void; nombrePdv: (id: number | null) => string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useFetchQuery<{ meses: MesSinCarga[] }>(["sin-carga", pdvId], `/api/sin-carga?pdvId=${pdvId}`, { staleTime: 60_000 });
  const [abierto, setAbierto] = useState<string | null>(null);
  // Deslizar (Diego 28/10): a la izquierda "Este mes no" (sigue los próximos meses), a la derecha
  // "Ya no va" (no es de todos los meses o ya no se contrata). Con "Deshacer" en el aviso.
  async function descartar(x: ItemSinCarga, mes: string | null) {
    // Sale de la lista en el acto (Diego 29/10: tardaba); si el servidor falla, vuelve.
    queryClient.setQueriesData<{ meses: MesSinCarga[] }>({ queryKey: ["sin-carga", pdvId] }, (v) => sinElGasto(v, x.clave, mes));
    const r = await fetch("/api/sin-carga/descartes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdvId, clave: claveDescarte(x.clave, mes), nombre: x.nombre }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) { toast.error("No se pudo marcar"); void queryClient.invalidateQueries({ queryKey: ["sin-carga"] }); return; }
    void queryClient.invalidateQueries({ queryKey: ["sin-carga"] });
    toast(mes ? `${x.nombre}: este mes no` : `${x.nombre}: ya no va`, {
      action: { label: "Deshacer", onClick: () => { void fetch(`/api/sin-carga/descartes?id=${d?.id}`, { method: "DELETE" }).then(() => queryClient.invalidateQueries({ queryKey: ["sin-carga"] })); } },
    });
  }
  if (isLoading || !data) return <p className="py-10 text-center text-zinc-500">Cargando…</p>;
  const mes0 = data.meses.find((m) => m.mes === mesInicial) ?? data.meses[0];
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
            {ver && porRubro(t.visibles).map(([rubro, items]) => (
              <div key={rubro}>
                <div className="flex pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{rubro}<span className="ml-auto">{items.length} · {$(items.reduce((s2, x) => s2 + x.ultimo, 0))}</span></div>
                {items.map((x) => (
              <Deslizable key={x.clave} onTap={() => onCargar(x, m.mes)} onIzquierda={() => void descartar(x, m.mes)} onDerecha={() => void descartar(x, null)}>
                <span className={cn("size-2 shrink-0 rounded-full", x.atrasado ? "bg-red-600" : "bg-zinc-300")} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{x.nombre}</span>
                  {x.queCompra && <span className="block truncate text-[12px] text-zinc-600 dark:text-zinc-300">{x.queCompra}</span>}
                  <span className={cn("block truncate text-[12px]", x.atrasado ? "text-red-600" : "text-zinc-500")}>{x.atrasado ? "atrasado" : "por venir"} · {x.vencido ? "mes vencido" : `suele el ${x.dia}`}</span>
                  {x.pdvOrigenId && x.pdvOrigenId !== pdvId && <span className="block truncate text-[11.5px] text-zinc-400">se carga en {nombrePdv(x.pdvOrigenId)} · {$(x.ultimoTotal)}</span>}</span>
                <b className="tabular-nums">{$(x.ultimo)}</b>
              </Deslizable>
                ))}
              </div>
            ))}
          </div>
        );
      })}
      <p className="mt-3 text-[12px] text-zinc-500">Tocá un gasto para cargarlo. Deslizalo ← “Este mes no” · → “Ya no va”.</p>
    </div>
  );
}

// Por rubro, de mayor a menor (igual que el Panel).
function porRubro(items: ItemSinCarga[]): [string, ItemSinCarga[]][] {
  const m = new Map<string, ItemSinCarga[]>();
  for (const x of items) m.set(x.rubro, [...(m.get(x.rubro) ?? []), x]);
  const tot = (xs: ItemSinCarga[]) => xs.reduce((s, x) => s + x.ultimo, 0);
  return [...m.entries()].sort((a, b) => tot(b[1]) - tot(a[1]));
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
    <div data-deslizable className="relative overflow-hidden border-t border-zinc-50 dark:border-zinc-900">
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
