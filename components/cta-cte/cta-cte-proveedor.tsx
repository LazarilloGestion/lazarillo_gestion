"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { fmtComprobante, fmtPesos } from "@/lib/impagas/clasificar";
import { ETIQUETA_ESTADO, totalesCtaCte, type EstadoPago } from "@/lib/cta-cte/estado";
import { OpMaxirestModal } from "@/components/impagas/op-maxirest-modal";
import { VerFactura } from "@/components/facturas/ver-factura";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Local } from "@/lib/types/domain";
import { numeroPago } from "@/lib/pagos-proveedor/imputar";
import { FormPagoProveedor, type CuerpoPagoProv, type ModoPagoProv, type PagoACuentaUI } from "./pago-proveedor";

// Cuenta corriente — SOLO LECTURA (punto 4, Etapa 3), diseño de ModalCtaCte_etapa3.
// Dos modos:
//  - Proveedor del maestro: sus facturas en todos los PDV (izquierda) y los
//    pagos del informe 80 de la factura tocada (derecha).
//  - Sin proveedor del maestro (empleado, gastos varios): sus movimientos del 14
//    en ese PDV (sueldos, adelantos…) agrupados por período, y a la derecha los
//    conceptos liquidados sumados.
// Etapa 4 (27/10/2026): pagos cargados en Lazarillo — tildar facturas y pagarlas,
// pago a cuenta, aplicar un pago a cuenta, corregir, quitar de una factura y anular.

export interface OrigenCtaCte {
  codPro: string;
  pdvId?: number | null; // con nombre: modo movimientos (identifica PDV + código + nombre)
  nombre?: string | null;
}

interface PagoCtaCte { fecha: string; importe: number; medio: string | null; orden: string | null }
interface PagoLzCtaCte { pagoId: number; fecha: string; importe: number; totalPago: number; medio: string; referencia: string | null; pdvPaga: string; conciliado: boolean }
interface FacturaCtaCte {
  pdvId: number; pdv: string; comprobante: string; fecha: string; total: number; pagado: number; conceptos: string;
  rowId: string | null; solo80: boolean; estado: EstadoPago | null; pagos: PagoCtaCte[]; pagosLz: PagoLzCtaCte[]; deMas: boolean;
}
interface MovimientoCtaCte {
  rowId: string; fecha: string; comprobante: string | null; concepto: string; rubro: string | null; observac: string; importe: number;
}
type CtaCteResp =
  | { modo: "facturas"; codPro: string; proveedor: string; cuit: string | null; pagoAutomatico: boolean; desdeCobertura: string; aCuenta: PagoACuentaUI[]; facturas: FacturaCtaCte[] }
  | { modo: "movimientos"; codPro: string; pdvId: number; pdv: string; nombre: string; proveedor: string; esEmpleado: boolean; movimientos: MovimientoCtaCte[] };

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const PROXIMAMENTE = "Próximamente — disponible en la etapa 4 (carga de pagos y comprobantes)";
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");
const nombreMes = (ym: string) => (ym.length >= 7 ? `${MESES_LARGO[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "Sin fecha");
const claveF = (f: { pdvId: number; comprobante: string }) => `${f.pdvId}|${f.comprobante}`;
const urlDe = (o: OrigenCtaCte) =>
  `/api/cta-cte?codPro=${encodeURIComponent(o.codPro)}${o.nombre && o.pdvId ? `&pdvId=${o.pdvId}&nombre=${encodeURIComponent(o.nombre)}` : ""}`;

// Colores sólidos del mockup.
const BADGE: Record<EstadoPago, string> = {
  paga: "bg-[#159457] text-white",
  parcial: "bg-[#e08900] text-white",
  impaga: "bg-[#c62828] text-white",
  auto: "bg-zinc-400 text-white",
  nc: "bg-sky-600 text-white",
  "sin-datos": "bg-zinc-200 text-zinc-600",
};
const PAGABLE = (e: EstadoPago | null) => e === "impaga" || e === "parcial" || e === "auto";
const saldoDe = (f: { total: number; pagado: number }) => Math.max(0, Math.round((f.total - f.pagado) * 100) / 100);
const RANK: Record<string, number> = { impaga: 0, parcial: 1, auto: 2, "sin-datos": 3, nc: 4, paga: 5, "": 6 };

type Periodo = "mes" | "anio" | "hist";
type CampoOrden = "fecha" | "comp" | "importe" | "estado";

// Agrupa una lista (ya ordenada) por mes de su fecha, respetando el orden.
function porMes<T extends { fecha: string }>(l: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of l) {
    const k = x.fecha.slice(0, 7);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return [...m.entries()];
}

function Gris({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span title={PROXIMAMENTE} className={cn("inline-flex opacity-50 cursor-not-allowed", className)}>{children}</span>;
}

// Buscador de proveedor (cambiar de proveedor sin cerrar).
function BuscadorProveedor({ valor, onElegir }: { valor: string; onElegir: (codPro: string) => void }) {
  const [texto, setTexto] = useState<string | null>(null); // null = muestra el proveedor actual
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ((texto ?? "").trim()), 250); return () => clearTimeout(t); }, [texto]);
  const { data } = useFetchQuery<{ proveedores: { codPro: string; nombre: string; facturas: number }[] }>(
    ["cta-cte-prov", q], `/api/cta-cte/proveedores?q=${encodeURIComponent(q)}`, { enabled: texto !== null && texto !== valor && q.length >= 2 },
  );
  const buscando = texto !== null && texto !== valor && q.length >= 2;
  const opciones = buscando ? data?.proveedores ?? [] : [];
  const elegir = (c: string) => { setTexto(null); onElegir(c); };
  return (
    <div className="relative w-60">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <input
        value={texto ?? valor}
        placeholder="Buscar proveedor..."
        onFocus={(e) => { setTexto(valor); e.currentTarget.select(); }}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && opciones[0]) elegir(opciones[0].codPro); if (e.key === "Escape") { e.stopPropagation(); setTexto(null); } }}
        onBlur={() => setTimeout(() => setTexto(null), 180)}
        className="h-9 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 pl-8 pr-2 text-sm outline-none focus:border-sky-500"
      />
      {opciones.length > 0 && (
        <div className="absolute left-0 right-0 top-[105%] z-50 max-h-60 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
          {opciones.map((o) => (
            <button key={o.codPro} type="button" onMouseDown={() => elegir(o.codPro)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sky-50 dark:hover:bg-sky-950/40 border-b border-zinc-100 dark:border-zinc-800">
              <span className="truncate">{o.nombre}</span><span className="text-[11px] text-muted-foreground">{o.facturas} fc.</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Encabezado de un grupo (mes) en la lista.
function FilaMes({ ym, n, total, unidad }: { ym: string; n: number; total: number; unidad: string }) {
  return (
    <div className="sticky top-0 z-[1] flex items-center gap-2.5 px-3 py-1.5 mt-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[12px] font-semibold">
      <span>{nombreMes(ym)}</span>
      <span className="font-normal text-zinc-500">· {n} {unidad}{n === 1 ? "" : "s"}</span>
      <span className="ml-auto tabular-nums">{fmtPesos(total)}</span>
      <span className="w-[78px]" />
    </div>
  );
}

export function CtaCteContenido({ origen: origenInicial, resaltado, onCerrar, titulo }: {
  origen: OrigenCtaCte;
  resaltado?: { pdvId: number; comprobante: string } | null; // factura a dejar elegida
  onCerrar?: () => void;
  titulo?: (nodo: React.ReactNode) => React.ReactNode;       // el modal lo envuelve en DialogTitle
}) {
  const [origen, setOrigen] = useState<OrigenCtaCte>(origenInicial);
  const esMovs = !!(origen.nombre && origen.pdvId);
  const { data, isLoading, isError } = useFetchQuery<CtaCteResp>(["cta-cte", origen.codPro, origen.pdvId ?? null, origen.nombre ?? null], urlDe(origen));
  const [sel, setSel] = useState<string | null>(resaltado ? claveF(resaltado) : null);
  const [verFact, setVerFact] = useState<{ rowId: string; detalle: string; repetir?: boolean } | null>(null);
  const [per, setPer] = useState<Periodo>("hist");
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth());
  const [anio, setAnio] = useState(hoy.getFullYear());
  // Siempre de la más nueva a la más vieja.
  const [orden, setOrden] = useState<{ campo: CampoOrden; dir: 1 | -1 }>({ campo: "fecha", dir: -1 });
  const [busca, setBusca] = useState("");
  // Agrupar por período: tildado de entrada para empleados / gastos varios.
  const [agrupar, setAgrupar] = useState(esMovs);
  const [opMx, setOpMx] = useState<{ pdvId: number; orden: string; fecha: string } | null>(null);
  const filaSel = useRef<HTMLDivElement | null>(null);
  // ---- pagos (etapa 4) ----
  const queryClient = useQueryClient();
  const [tildadas, setTildadas] = useState<Set<string>>(() => new Set());
  const [form, setForm] = useState<{ tipo: "facturas" } | { tipo: "cuenta" } | { tipo: "editar"; pagoId: number } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [anulando, setAnulando] = useState<number | null>(null);
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const pdvs = useMemo(() => (locales ?? []).flatMap((l) => l.puntosDeVenta.map((p) => ({ id: p.id, label: `${l.nombre} · ${p.nombre}` }))), [locales]);

  const enPeriodo = (iso: string) =>
    per === "hist" || (per === "anio" ? iso.startsWith(String(anio)) : iso.startsWith(`${anio}-${String(mes + 1).padStart(2, "0")}`));
  const mover = (d: number) => {
    if (per === "anio") { setAnio((a) => a + d); return; }
    let n = mes + d, a = anio;
    if (n < 0) { n = 11; a--; } else if (n > 11) { n = 0; a++; }
    setMes(n); setAnio(a);
  };
  const clickOrden = (campo: CampoOrden) => setOrden((o) => (o.campo === campo ? { campo, dir: (-o.dir) as 1 | -1 } : { campo, dir: campo === "fecha" ? -1 : 1 }));
  const flecha = (c: CampoOrden) => (orden.campo === c ? (orden.dir === 1 ? " ▲" : " ▼") : "");
  const etiquetaPeriodo = per === "hist" ? "histórico" : per === "anio" ? String(anio) : `${MESES[mes]} ${anio}`;
  const t = busca.trim().toLowerCase();
  const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0) * orden.dir;

  // ---- modo facturas ----
  const facturas = useMemo(() => (data?.modo === "facturas" ? data.facturas : []), [data]);
  const fact = facturas.find((f) => claveF(f) === sel) ?? null;
  const aCuenta = data?.modo === "facturas" ? data.aCuenta : [];
  const disponibleACuenta = aCuenta.reduce((s, p) => s + p.disponible, 0);
  const elegidas = facturas.filter((f) => tildadas.has(claveF(f)) && PAGABLE(f.estado));
  const saldoElegidas = elegidas.reduce((s, f) => s + saldoDe(f), 0);
  // Todos los pagos de Lazarillo del proveedor (para "ver orden", editar y anular).
  const pagosLzPorId = new Map<number, PagoLzCtaCte & { facturas: FacturaCtaCte[] }>();
  for (const f of facturas) for (const p of f.pagosLz) {
    const x = pagosLzPorId.get(p.pagoId) ?? { ...p, facturas: [] };
    x.facturas.push(f); pagosLzPorId.set(p.pagoId, x);
  }

  async function llamar(url: string, init: RequestInit, ok: string): Promise<string | null> {
    setGuardando(true);
    try {
      const res = await fetch(url, init);
      const b = await res.json().catch(() => null);
      if (!res.ok) return b?.error ?? "No se pudo guardar.";
      toast.success(ok);
      for (const k of ["cta-cte", "impagas", "detalle", "pivot", "actividad"]) void queryClient.invalidateQueries({ queryKey: [k] });
      return null;
    } catch {
      return "No se pudo guardar. Intentá de nuevo.";
    } finally {
      setGuardando(false);
    }
  }
  async function confirmarPago(b: CuerpoPagoProv): Promise<string | null> {
    if (!form || data?.modo !== "facturas") return null;
    if (form.tipo === "editar") {
      const err = await llamar(`/api/pagos-proveedor/${form.pagoId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }, `${numeroPago(form.pagoId)} corregido`);
      if (!err) setForm(null);
      return err;
    }
    const body = { codPro: data.codPro, ...b, ...(form.tipo === "facturas" ? { facturas: elegidas.map((f) => ({ pdvId: f.pdvId, comprobante: f.comprobante })) } : {}) };
    const err = await llamar("/api/pagos-proveedor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      b.usarPago ? `${numeroPago(b.usarPago)} aplicado` : form.tipo === "cuenta" ? "Pago a cuenta registrado" : "Pago registrado");
    if (!err) { setForm(null); setTildadas(new Set()); }
    return err;
  }
  async function quitar(pagoId: number, f: FacturaCtaCte) {
    const err = await llamar(`/api/pagos-proveedor/${pagoId}/aplicaciones?pdvId=${f.pdvId}&comprobante=${encodeURIComponent(f.comprobante)}`, { method: "DELETE" },
      `Quitado de ${fmtComprobante(f.comprobante)}: el importe queda a cuenta`);
    if (err) toast.error(err);
  }
  async function anular(pagoId: number) {
    const err = await llamar(`/api/pagos-proveedor/${pagoId}`, { method: "DELETE" }, `${numeroPago(pagoId)} anulado`);
    if (err) toast.error(err);
    setAnulando(null);
  }
  async function aplicarACuenta(p: PagoACuentaUI) {
    if (data?.modo !== "facturas" || !elegidas.length) return;
    const err = await llamar("/api/pagos-proveedor", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codPro: data.codPro, usarPago: p.id, facturas: elegidas.map((f) => ({ pdvId: f.pdvId, comprobante: f.comprobante })) }) },
      `${numeroPago(p.id)} aplicado`);
    if (err) toast.error(err); else setTildadas(new Set());
  }
  const valF = (f: FacturaCtaCte): string | number =>
    orden.campo === "importe" ? f.total : orden.campo === "estado" ? RANK[f.estado ?? ""] : orden.campo === "comp" ? f.comprobante : f.fecha;
  const tn = t.replace(/[\s-]/g, "");
  const visiblesF = facturas
    .filter((f) => enPeriodo(f.fecha) && (!tn || f.comprobante.toLowerCase().includes(tn) || fmtComprobante(f.comprobante).toLowerCase().replace(/[\s-]/g, "").includes(tn)))
    .sort((a, b) => cmp(valF(a), valF(b)));
  const totF = totalesCtaCte(visiblesF);
  const pagosLista = fact
    ? fact.pagos.map((p) => ({ ...p, f: fact }))
    : facturas.flatMap((f) => f.pagos.map((p) => ({ ...p, f }))).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const pagosLzLista = fact
    ? fact.pagosLz.map((p) => ({ p, f: fact }))
    : facturas.flatMap((f) => f.pagosLz.map((p) => ({ p, f }))).sort((a, b) => b.p.fecha.localeCompare(a.p.fecha));

  // ---- modo movimientos ----
  const movs = useMemo(() => (data?.modo === "movimientos" ? data.movimientos : []), [data]);
  const valM = (m: MovimientoCtaCte): string | number => (orden.campo === "importe" ? m.importe : orden.campo === "comp" ? m.concepto : m.fecha);
  const visiblesM = movs
    .filter((m) => enPeriodo(m.fecha) && (!t || m.concepto.toLowerCase().includes(t) || m.observac.toLowerCase().includes(t)))
    .sort((a, b) => cmp(valM(a), valM(b)));
  const totalM = visiblesM.reduce((s, m) => s + m.importe, 0);
  // Conceptos liquidados del período (o del mes elegido).
  const mesSel = sel?.startsWith("mes:") ? sel.slice(4) : null;
  const resumen = (() => {
    const m = new Map<string, { n: number; total: number }>();
    for (const x of visiblesM) {
      if (mesSel && !x.fecha.startsWith(mesSel)) continue;
      const r = m.get(x.concepto) ?? { n: 0, total: 0 };
      r.n++; r.total += x.importe; m.set(x.concepto, r);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  })();

  useEffect(() => { filaSel.current?.scrollIntoView({ block: "center" }); }, [data]);

  const cambiarProv = (c: string) => { setOrigen({ codPro: c }); setSel(null); setBusca(""); setAgrupar(false); setTildadas(new Set()); setForm(null); };
  const tituloNodo = <span className="text-[19px] font-normal whitespace-nowrap">— cuenta corriente</span>;
  const nombreHeader = data?.proveedor ?? origen.nombre ?? "";

  const toolbar = (rotulo: string, placeholder: string) => (
    <div className="flex flex-wrap items-center gap-2 mb-2.5 shrink-0">
      <span className="text-[11.5px] font-bold uppercase tracking-wide text-zinc-500">{rotulo}</span>
      {per !== "hist" && (
        <>
          <button type="button" onClick={() => mover(-1)} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 text-[13px] text-zinc-600">‹</button>
          <span className="min-w-[70px] text-center text-[12.5px] font-bold">{per === "anio" ? anio : `${MESES[mes]} ${anio}`}</span>
          <button type="button" onClick={() => mover(1)} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 text-[13px] text-zinc-600">›</button>
        </>
      )}
      <span className="relative flex-1 min-w-[9rem]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={placeholder}
          className="h-8 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 pl-8 pr-2 text-[13px] outline-none focus:border-sky-500" />
      </span>
      <label className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-zinc-600 dark:text-zinc-300 cursor-pointer select-none" title="Agrupar por mes, con el subtotal de cada uno">
        <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} className="h-3.5 w-3.5 accent-zinc-900" />
        Agrupar por período
      </label>
      <span className="inline-flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        {([["mes", "Mes"], ["anio", "Año"], ["hist", "Histórico"]] as [Periodo, string][]).map(([k, tx]) => (
          <button key={k} type="button" onClick={() => setPer(k)}
            className={cn("px-2.5 py-1 text-[11.5px] font-bold", per === k ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500")}>{tx}</button>
        ))}
      </span>
    </div>
  );

  const filaFactura = (f: FacturaCtaCte) => {
    const on = fact != null && claveF(f) === claveF(fact);
    return (
      <div key={claveF(f)} ref={on ? filaSel : undefined}
        onClick={() => {
          // Gesto unificado (prototipo): click en la fila = tildar/destildar y ver sus pagos.
          const k = claveF(f);
          if (PAGABLE(f.estado)) {
            const n = new Set(tildadas);
            if (n.has(k)) n.delete(k); else n.add(k);
            setTildadas(n);
            setSel(k);
            if (form?.tipo === "facturas" && n.size === 0) setForm(null);
          } else setSel(on ? null : k);
        }}
        onDoubleClick={() => { if (f.rowId) setVerFact({ rowId: f.rowId, detalle: fmtComprobante(f.comprobante) }); }}
        title={f.rowId ? "Doble clic: ver la factura" : undefined}
        className={cn("flex items-center gap-2.5 px-3 py-1.5 rounded-md cursor-pointer border-b border-zinc-100 dark:border-zinc-800",
          on ? "bg-[#eef6fb] dark:bg-sky-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40")}>
        {PAGABLE(f.estado)
          ? <input type="checkbox" readOnly checked={tildadas.has(claveF(f))} className="h-[13px] w-[13px] accent-zinc-900 cursor-pointer" />
          : <span className="w-[13px]" />}
        <span className="w-[62px] text-[12.5px] text-zinc-600 dark:text-zinc-300 tabular-nums">{dmy(f.fecha)}</span>
        {/* Una sola fila: comprobante y, a la derecha, el PDV en gris. */}
        <span className="flex-1 min-w-0 flex items-baseline gap-2 text-[13px] whitespace-nowrap">
          <span className="tabular-nums shrink-0">{fmtComprobante(f.comprobante)}</span>
          {f.solo80 && <span className="text-[10px] text-muted-foreground shrink-0" title="El pago está en el informe 80 pero la factura no está en el 14">solo 80</span>}
          <span className="truncate text-[11.5px] text-zinc-500" title={f.pdv}>{f.pdv}</span>
        </span>
        <span className="w-[110px] text-right text-[13px] font-semibold tabular-nums">{fmtPesos(f.total)}</span>
        <span className="w-[78px] text-right">
          {f.estado ? (
            <span title={f.estado === "sin-datos" && data?.modo === "facturas" ? `El informe 80 no cubre antes del ${dmy(data.desdeCobertura)}` : undefined}
              className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase whitespace-nowrap", BADGE[f.estado])}>
              {f.estado === "sin-datos" ? "s/datos" : f.estado === "auto" ? "automát." : ETIQUETA_ESTADO[f.estado]}
            </span>
          ) : <span className="text-[11px] text-muted-foreground">—</span>}
        </span>
      </div>
    );
  };

  const filaMov = (m: MovimientoCtaCte) => (
    <div key={m.rowId} className="flex items-center gap-2.5 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800 text-[13px]">
      <span className="w-[62px] text-[12.5px] text-zinc-600 dark:text-zinc-300 tabular-nums">{dmy(m.fecha)}</span>
      <span className="flex-1 min-w-0 flex items-baseline gap-2 whitespace-nowrap">
        <span className="truncate" title={m.concepto}>{m.concepto}</span>
        {m.observac && <span className="truncate text-[11.5px] text-zinc-500" title={m.observac}>{m.observac}</span>}
      </span>
      <span className="w-[110px] text-right font-semibold tabular-nums">{fmtPesos(m.importe)}</span>
      <span className="w-[78px]" />
    </div>
  );

  const vacio = (
    <p className="px-3 py-2.5 text-[12.5px] text-zinc-500">
      {t ? "Nada coincide con la búsqueda." : "Nada en este período — probá Año o Histórico."}
    </p>
  );

  return (
    <div className="flex flex-col h-full min-h-0 px-6 pt-5 pb-4">
      {/* ===== encabezado ===== */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 shrink-0">
        <BuscadorProveedor valor={nombreHeader} onElegir={cambiarProv} />
        {titulo ? titulo(tituloNodo) : tituloNodo}
        {data?.modo === "facturas" && data.pagoAutomatico && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-zinc-100 text-zinc-600">pago automático</span>}
        {data?.modo === "movimientos" && (
          <span className="text-[12.5px] text-zinc-500">
            {data.esEmpleado ? "Empleado" : "Sin proveedor del maestro"} · {data.pdv}
          </span>
        )}
        {onCerrar && (
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="ml-auto text-zinc-400 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
      ) : isError || !data ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No se pudo leer la cuenta corriente.</div>
      ) : data.modo === "movimientos" ? (
        /* ================= empleados / gastos varios ================= */
        <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-6 mt-4 flex-1 min-h-0">
          <div className="flex flex-col min-h-0">
            {toolbar(data.esEmpleado ? "Liquidaciones" : "Movimientos", "Buscar concepto u observación...")}
            <div className="flex gap-2.5 px-3 pb-1.5 text-[10.5px] font-bold text-zinc-500 shrink-0">
              <button type="button" onClick={() => clickOrden("fecha")} className="w-[62px] text-left">FECHA{flecha("fecha")}</button>
              <button type="button" onClick={() => clickOrden("comp")} className="flex-1 text-left">CONCEPTO · OBSERVACIÓN{flecha("comp")}</button>
              <button type="button" onClick={() => clickOrden("importe")} className="w-[110px] text-right">IMPORTE{flecha("importe")}</button>
              <span className="w-[78px]" />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {visiblesM.length === 0 && vacio}
              {agrupar
                ? porMes(visiblesM).map(([ym, l]) => (
                    <Fragment key={ym}>
                      <div onClick={() => setSel(sel === `mes:${ym}` ? null : `mes:${ym}`)} className="cursor-pointer" title="Ver los conceptos de este mes a la derecha">
                        <FilaMes ym={ym} n={l.length} total={l.reduce((s, m) => s + m.importe, 0)} unidad="movimiento" />
                      </div>
                      {l.map(filaMov)}
                    </Fragment>
                  ))
                : visiblesM.map(filaMov)}
            </div>
          </div>
          <div className="flex flex-col min-h-0">
            <div className="flex items-center gap-2.5 mb-2 shrink-0">
              <span className="text-[11.5px] font-bold uppercase tracking-wide text-zinc-500">
                Conceptos {data.esEmpleado ? "liquidados" : ""} · {mesSel ? nombreMes(mesSel) : etiquetaPeriodo}
              </span>
              {mesSel && <button type="button" onClick={() => setSel(null)} className="ml-auto text-[11.5px] text-[#0d6fa8] hover:underline">ver todo el período</button>}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {resumen.length === 0 && <p className="py-2 text-[13px] text-zinc-500">Sin movimientos.</p>}
              {resumen.map(([c, r]) => (
                <div key={c} className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 px-1 py-1.5 text-[13px]">
                  <span className="flex-1 truncate" title={c}>{c}</span>
                  <span className="text-[11.5px] text-zinc-500">{r.n} mov.</span>
                  <span className="w-[110px] text-right font-semibold tabular-nums">{fmtPesos(r.total)}</span>
                </div>
              ))}
              {resumen.length > 0 && (
                <div className="flex items-center gap-3 px-1 py-2 text-[13px] font-bold">
                  <span className="flex-1">Total</span>
                  <span className="w-[110px] text-right tabular-nums">{fmtPesos(resumen.reduce((s, [, r]) => s + r.total, 0))}</span>
                </div>
              )}
              <p className="mt-2 text-[11.5px] text-zinc-500">
                Sueldos y gastos varios se cargan en MaxiRest junto con su pago: no tienen factura ni pagos aparte.
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* ================= proveedor del maestro ================= */
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-6 mt-4 flex-1 min-h-0">
          <div className="flex flex-col min-h-0">
            {toolbar("Facturas", "Buscar comprobante...")}
            <div className="flex gap-2.5 px-3 pb-1.5 text-[10.5px] font-bold text-zinc-500 shrink-0">
              <span className="w-[13px]" />
              <button type="button" onClick={() => clickOrden("fecha")} className="w-[62px] text-left">FECHA{flecha("fecha")}</button>
              <button type="button" onClick={() => clickOrden("comp")} className="flex-1 text-left">COMPROBANTE{flecha("comp")}</button>
              <button type="button" onClick={() => clickOrden("importe")} className="w-[110px] text-right">IMPORTE{flecha("importe")}</button>
              <button type="button" onClick={() => clickOrden("estado")} className="w-[78px] text-right">ESTADO{flecha("estado")}</button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {visiblesF.length === 0 && vacio}
              {agrupar
                ? porMes(visiblesF).map(([ym, l]) => (
                    <Fragment key={ym}>
                      <FilaMes ym={ym} n={l.length} total={l.reduce((s, f) => s + f.total, 0)} unidad="factura" />
                      {l.map(filaFactura)}
                    </Fragment>
                  ))
                : visiblesF.map(filaFactura)}
            </div>
          </div>

          {/* ===== pagos ===== */}
          <div className="flex flex-col min-h-0">
            <div className="flex flex-wrap items-center gap-2.5 mb-2 shrink-0">
              <span className="text-[11.5px] font-bold uppercase tracking-wide text-zinc-500">
                {fact ? `Pagos de ${fmtComprobante(fact.comprobante)}` : "Todos los pagos del proveedor"}
              </span>
              <span className="ml-auto flex gap-2.5">
                {/* Ver la factura con el formato de la carga (y editarla / eliminarla si es de Lazarillo). */}
                {fact?.rowId && <button type="button" onClick={() => setVerFact({ rowId: fact.rowId!, detalle: fmtComprobante(fact.comprobante) })}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">Ver / editar {fmtComprobante(fact.comprobante)}</button>}
                {fact?.rowId
                  ? <button type="button" onClick={() => setVerFact({ rowId: fact.rowId!, detalle: fmtComprobante(fact.comprobante), repetir: true })}
                      title="Cargar una factura nueva con la estructura de esta"
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">⟳ Repetir</button>
                  : <Gris><button type="button" disabled className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold">⟳ Repetir</button></Gris>}
                {elegidas.length > 0
                  ? <button type="button" onClick={() => setForm({ tipo: "facturas" })}
                      className="rounded-lg bg-zinc-900 px-4 py-1.5 text-[13px] font-semibold text-white dark:bg-white dark:text-zinc-900">
                      Pagar seleccionada{elegidas.length === 1 ? "" : "s"} ({elegidas.length} · {fmtPesos(saldoElegidas)})
                    </button>
                  : <button type="button" onClick={() => setForm({ tipo: "cuenta" })} title="Sin facturas tildadas: queda a cuenta del proveedor"
                      className="rounded-lg bg-zinc-900 px-4 py-1.5 text-[13px] font-semibold text-white dark:bg-white dark:text-zinc-900">+ Cargar pago</button>}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {pagosLista.length === 0 && pagosLzLista.length === 0 && <p className="py-2 text-[13px] text-zinc-500">Sin pagos registrados.</p>}
              {pagosLzLista.map(({ p, f }) => (
                <div key={`lz-${p.pagoId}-${claveF(f)}`} className={cn("mb-2 rounded-xl border px-3.5 py-2.5", p.conciliado ? "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/60" : "border-[#bfe6f6] bg-white dark:border-sky-900 dark:bg-zinc-900")}>
                  <div className="flex items-center justify-between gap-3 text-[13.5px]">
                    <b className="tabular-nums">{dmy(p.fecha)} · {fmtPesos(p.importe)}</b>
                    <span className="flex items-center gap-3 text-[11.5px] text-zinc-500">
                      <button type="button" onClick={() => setForm({ tipo: "editar", pagoId: p.pagoId })} className="hover:text-zinc-800" title="Corregir fecha, medio, ID, PDV o importe">✎</button>
                      <button type="button" onClick={() => void quitar(p.pagoId, f)} className="underline-offset-2 hover:underline" title="Sacar este pago de la factura: el importe queda a cuenta">quitar</button>
                      {anulando === p.pagoId
                        ? <span className="text-red-600">¿Anular {numeroPago(p.pagoId)}? <button type="button" onClick={() => void anular(p.pagoId)} className="font-semibold underline">Sí</button> · <button type="button" onClick={() => setAnulando(null)} className="underline">No</button></span>
                        : <button type="button" onClick={() => setAnulando(p.pagoId)} className="underline-offset-2 hover:underline hover:text-red-600">anular</button>}
                    </span>
                  </div>
                  {!fact && <div className="mt-0.5 text-[12px] text-zinc-500">a {fmtComprobante(f.comprobante)} · {dmy(f.fecha)}</div>}
                  <div className="mt-0.5 text-[12.5px] text-zinc-600 dark:text-zinc-300">
                    {p.medio}{p.referencia && <span className="font-mono text-[11.5px]"> · ID {p.referencia}</span>} · {numeroPago(p.pagoId)}
                    {p.totalPago - p.importe > 0.004 && <span className="text-zinc-400"> · parte de {fmtPesos(p.totalPago)}</span>}
                    <span className="ml-1.5 rounded border border-[#5BC2EA] bg-[#ecfaff] px-1 text-[10px] font-semibold text-[#0e7490]">Lazarillo</span>
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[#0d6fa8]">Pagado por: <b>{p.pdvPaga}</b></div>
                  {p.conciliado && <div className="mt-1 text-[11.5px] text-zinc-500">También está en MaxiRest (mismo importe y fecha): se cuenta una sola vez.</div>}
                </div>
              ))}
              {pagosLista.map((p, i) => (
                <div key={`${claveF(p.f)}-${i}`} className="mb-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-[#fafaf8] dark:bg-zinc-900/60 px-3.5 py-2.5">
                  <div className="flex items-center justify-between text-[13.5px]">
                    <b className="tabular-nums">{dmy(p.fecha)} · {fmtPesos(p.importe)}</b>
                    <span className="text-[11px] text-zinc-400" title="Viene del informe 80 de MaxiRest: se corrige allá">solo lectura</span>
                  </div>
                  {!fact && <div className="mt-0.5 text-[12px] text-zinc-500">a {fmtComprobante(p.f.comprobante)} · {dmy(p.f.fecha)}</div>}
                  <div className="mt-0.5 text-[12.5px] text-zinc-600 dark:text-zinc-300">
                    {p.medio ?? "—"}
                    {p.orden && (
                      <button type="button" onClick={() => setOpMx({ pdvId: p.f.pdvId, orden: p.orden!, fecha: p.fecha })}
                        className="ml-1.5 text-[#0d6fa8] hover:underline">· OP {p.orden} ›</button>
                    )}
                    <span className="text-zinc-400"> · MaxiRest</span>
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[#0d6fa8]">Pagado por: <b>{p.f.pdv}</b></div>
                </div>
              ))}
              {fact?.deMas && (
                <div className="mb-2.5 rounded-xl border-[1.5px] border-red-300 bg-red-50 px-3.5 py-2 text-[13px] text-red-700 dark:bg-red-950/40">
                  ⚠ Pagada de más: entre MaxiRest y Lazarillo suman {fmtPesos(fact.pagado)} sobre {fmtPesos(fact.total)}. Revisá si un pago está cargado dos veces.
                </div>
              )}
              {fact && (fact.estado === "impaga" || fact.estado === "parcial") && (
                <div className="mb-2.5 rounded-xl border-[1.5px] border-[#f0c179] px-3.5 py-2 text-[13px] text-[#e08900]">
                  Saldo pendiente de esta factura: <b>{fmtPesos(fact.total - fact.pagado)}</b>
                </div>
              )}
              {fact && fact.estado === "paga" && (
                <div className="mb-2.5 flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#bfe3cf] bg-[#f2faf5] px-3.5 py-2 text-[13px] font-semibold text-[#159457]">
                  <Check className="h-4 w-4" /> Factura paga
                </div>
              )}
              {fact && fact.estado && !["impaga", "parcial", "paga"].includes(fact.estado) && (
                <div className="mb-2.5 rounded-xl border border-zinc-200 px-3.5 py-2 text-[13px] text-zinc-600">
                  {fact.estado === "sin-datos" ? `Sin datos de pago: el informe 80 no cubre antes del ${dmy(data.desdeCobertura)}.`
                    : fact.estado === "auto" ? "Proveedor con pago automático: sin pago registrado no cuenta como deuda."
                    : "Nota de crédito."}
                </div>
              )}
              {aCuenta.length > 0 && (
                <>
                  <div className="mt-3 mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-zinc-500">Pagos a cuenta — crédito disponible</div>
                  {aCuenta.map((p) => (
                    <div key={p.id} className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-[#bfe6f6] bg-[#f0faff] dark:border-sky-900 dark:bg-sky-950/40 px-3.5 py-2.5 text-[13px]">
                      <div className="min-w-0">
                        <b>{numeroPago(p.id)}</b> · {dmy(p.fecha)} · {p.medio}{p.referencia && <span className="font-mono text-[11.5px]"> · ID {p.referencia}</span>}
                        <div className="text-[12px] text-zinc-500">
                          Pagado {fmtPesos(p.importe)} · usado {fmtPesos(p.importe - p.disponible)} · <b className="text-[#0e7490]">disponible {fmtPesos(p.disponible)}</b>
                        </div>
                      </div>
                      <span className="ml-auto flex items-center gap-3 text-[11.5px] text-zinc-500">
                        <button type="button" onClick={() => setForm({ tipo: "editar", pagoId: p.id })} className="hover:text-zinc-800" title="Corregir fecha, medio, ID, PDV o importe">✎</button>
                        {elegidas.length > 0
                          ? <button type="button" disabled={guardando} onClick={() => void aplicarACuenta(p)}
                              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100">
                              Aplicar a seleccionada{elegidas.length === 1 ? "" : "s"}
                            </button>
                          : <span>tildá facturas para aplicarlo</span>}
                        {anulando === p.id
                          ? <span className="text-red-600">¿Anular? <button type="button" onClick={() => void anular(p.id)} className="font-semibold underline">Sí</button> · <button type="button" onClick={() => setAnulando(null)} className="underline">No</button></span>
                          : <button type="button" onClick={() => setAnulando(p.id)} className="underline-offset-2 hover:underline hover:text-red-600">anular</button>}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== barra de pago (etapa 4) ===== */}
      {form && data?.modo === "facturas" && (() => {
        const pe = form.tipo === "editar" ? pagosLzPorId.get(form.pagoId) : null;
        const pc = form.tipo === "editar" ? aCuenta.find((x) => x.id === form.pagoId) : null;
        const modo: ModoPagoProv | null = form.tipo === "facturas" ? (elegidas.length ? { tipo: "facturas", n: elegidas.length, saldo: saldoElegidas } : null)
          : form.tipo === "cuenta" ? { tipo: "cuenta" }
          : pe ? { tipo: "editar", pago: { id: pe.pagoId, fecha: pe.fecha, medio: pe.medio, referencia: pe.referencia, importe: pe.totalPago,
              pdvPagaId: pdvs.find((x) => x.label === pe.pdvPaga)?.id ?? pdvs[0]?.id ?? 0 } }
          : pc ? { tipo: "editar", pago: { id: pc.id, fecha: pc.fecha, medio: pc.medio, referencia: pc.referencia, importe: pc.importe, pdvPagaId: pc.pdvPagaId } }
          : null;
        if (!modo) return null;
        return (
          <FormPagoProveedor key={form.tipo === "editar" ? `e${form.pagoId}` : form.tipo}
            modo={modo} proveedor={data.proveedor} pdvs={pdvs} pdvDefault={elegidas[0]?.pdvId ?? fact?.pdvId ?? null}
            aCuenta={aCuenta} guardando={guardando} onCancel={() => { if (form.tipo === "facturas") setTildadas(new Set()); setForm(null); }} onConfirm={confirmarPago} />
        );
      })()}

      {/* ===== pie: totales de lo que se ve ===== */}
      {data && (
        <div className="mt-3 -mx-6 -mb-4 px-6 py-2.5 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/60 flex flex-wrap items-center gap-x-6 gap-y-1 shrink-0 text-[13.5px]">
          {data.modo === "movimientos" ? (
            <>
              <span className="text-[11.5px] text-zinc-500">{visiblesM.length} movimiento{visiblesM.length === 1 ? "" : "s"} · {etiquetaPeriodo}</span>
              <span className="ml-auto text-zinc-600 dark:text-zinc-300">Total <b className="tabular-nums text-zinc-900 dark:text-zinc-100">{fmtPesos(totalM)}</b></span>
            </>
          ) : (
            <>
              <span className="text-[11.5px] text-zinc-500">{visiblesF.length} factura{visiblesF.length === 1 ? "" : "s"} · {etiquetaPeriodo}</span>
              <span className="ml-auto text-zinc-600 dark:text-zinc-300">Total <b className="tabular-nums text-zinc-900 dark:text-zinc-100">{fmtPesos(totF.total)}</b></span>
              <span className="text-zinc-600 dark:text-zinc-300" title="Pagos cargados en Lazarillo que todavía no se aplicaron a facturas">
                A cuenta <b className={disponibleACuenta > 0.004 ? "tabular-nums text-[#0e7490]" : "text-zinc-400"}>{disponibleACuenta > 0.004 ? fmtPesos(disponibleACuenta) : "—"}</b>
              </span>
              <span className="text-zinc-600 dark:text-zinc-300" title="Lo que se debe de las facturas que se ven, menos lo que hay a cuenta">
                Saldo <b className={cn("tabular-nums", totF.saldo - disponibleACuenta > 0.5 ? "text-[#c62828]" : "text-[#159457]")}>{fmtPesos(Math.max(0, totF.saldo - disponibleACuenta))}</b>
              </span>
            </>
          )}
        </div>
      )}

      {verFact && <VerFactura rowId={verFact.rowId} detalle={verFact.detalle} vistaInicial={verFact.repetir ? "repetir" : "ver"} onClose={() => setVerFact(null)} />}
      {opMx && (
        <OpMaxirestModal pdvId={opMx.pdvId} orden={opMx.orden} fecha={opMx.fecha}
          onCambiar={(fecha) => setOpMx({ ...opMx, fecha })} onCerrar={() => setOpMx(null)} />
      )}
    </div>
  );
}

// Modal propio (desde el proveedor de Detalle de compras o desde Impagas).
export function CtaCteModal({ origen, resaltado, onCerrar }: {
  origen: OrigenCtaCte; resaltado?: { pdvId: number; comprobante: string } | null; onCerrar: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()} className="w-[min(1180px,94vw)] max-w-[94vw] sm:max-w-[1180px] h-[min(90vh,820px)] flex flex-col gap-0 p-0 overflow-hidden">
        <CtaCteContenido origen={origen} resaltado={resaltado} onCerrar={onCerrar}
          titulo={(n) => <DialogTitle asChild>{n}</DialogTitle>} />
      </DialogContent>
    </Dialog>
  );
}

// Cómo abrir la cuenta corriente desde una fila con proveedor del ERP: con
// proveedor del maestro, por código (todos los PDV); sin él (empleado, gastos
// varios), por PDV + código + nombre.
export function origenDeFila(r: { codigo: string | null | undefined; pdvId: number | null | undefined; nombre: string | null | undefined; tieneMaestro: boolean }): OrigenCtaCte | null {
  if (!r.codigo) return null;
  if (r.tieneMaestro) return { codPro: r.codigo };
  if (r.pdvId == null || !r.nombre?.trim()) return null;
  return { codPro: r.codigo, pdvId: r.pdvId, nombre: r.nombre.trim() };
}
