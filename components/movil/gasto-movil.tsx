"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useMediosPago } from "@/hooks/use-medios-pago";
import { mediosParaElegir } from "@/lib/medios-pago/abm";
import { normalizarBusqueda } from "@/lib/impagas/clasificar";
import { fechaDelPeriodo, moverPeriodo, nombrePeriodo, periodoDe } from "@/lib/gastos-varios/periodo";
import type { Maestros } from "@/components/facturas/cargar-factura";

// Ticket / gasto vario desde el celular (Diego 27/10/2026): período (mes), concepto,
// detalle e importe; la fecha va al 15 del período salvo que se cambie. Pagado de
// entrada (medio + fecha de pago); sin pago queda IMPAGO. Mismo POST que la compu.

const $ = (n: number) => "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aNumero = (t: string) => { const v = parseFloat(t.replace(/\./g, "").replace(",", ".")); return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0; };
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dmy = (iso: string) => iso.split("-").reverse().join("/");
const lbl = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mt-3 mb-1";
const inp = "w-full h-11 rounded-xl border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 text-[15px]";

type Parecido = { fecha: string; importe: number; origen: string | null; observac: string | null };

// Desde "Sin carga" llega precargado: concepto, período e importe del último mes.
export function GastoMovil({ pdvId, onCerrar, inicial }: {
  pdvId: number; onCerrar: () => void; inicial?: { conceptoCodigo: string | null; periodo: string; importe: number };
}) {
  const queryClient = useQueryClient();
  const { data: maestros } = useFetchQuery<Maestros>(["facturas-maestros"], "/api/facturas/maestros", { staleTime: 15 * 60_000 });
  const conceptos = maestros?.conceptos ?? [];
  const [periodo, setPeriodo] = useState(inicial?.periodo ?? periodoDe(hoy()));
  const [fecha, setFecha] = useState(fechaDelPeriodo(inicial?.periodo ?? periodoDe(hoy())));
  const [cambiarFecha, setCambiarFecha] = useState(false);
  const elegirPeriodo = (p: string) => { setPeriodo(p); setFecha(fechaDelPeriodo(p)); };
  const [conceptoCod, setConceptoCod] = useState<string | null>(inicial?.conceptoCodigo ?? null);
  const concepto = conceptos.find((c) => c.codigo === conceptoCod) ?? null;
  const setConcepto = (c: { codigo: string } | null) => setConceptoCod(c?.codigo ?? null);
  const [busca, setBusca] = useState("");
  const [detalle, setDetalle] = useState("");
  const [importeTxt, setImporteTxt] = useState(inicial?.importe ? inicial.importe.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "");
  const importe = aNumero(importeTxt);

  const { data: mediosData } = useMediosPago();
  const medios = mediosParaElegir(mediosData);
  const [pagado, setPagado] = useState(true);
  const [medio, setMedio] = useState("");
  const [fechaPago, setFechaPago] = useState(hoy());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parecido, setParecido] = useState<Parecido | null>(null);

  const opciones = busca.trim().length >= 2
    ? conceptos.filter((c) => normalizarBusqueda(`${c.nombre} ${c.rubro}`).includes(normalizarBusqueda(busca))).slice(0, 8)
    : [];

  async function guardar(forzar: boolean) {
    setError(null);
    if (!concepto) { setError("Elegí el concepto."); return; }
    if (!(importe > 0)) { setError("Poné el importe."); return; }
    const medioPago = medio || medios[0]?.nombre;
    if (pagado && !medioPago) { setError("Elegí el medio de pago."); return; }
    setGuardando(true);
    try {
      const body = {
        pdvId, conceptoCodigo: concepto.codigo, detalle: detalle.trim() || null, importe, fecha, forzar,
        pago: pagado ? { fecha: fechaPago, medio: medioPago, referencia: null, pdvPagaId: pdvId } : null,
      };
      const res = await fetch("/api/gastos-varios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => null);
      if (!res.ok && d?.parecido) { setParecido(d.parecido as Parecido); return; }
      if (!res.ok) { setError([d?.error ?? "No se pudo guardar.", ...((d?.detalle as string[] | undefined) ?? [])].join(" ")); return; }
      toast.success(pagado ? "Gasto cargado y pagado" : "Gasto cargado (impago)", { description: `${concepto.nombre} · ${$(d.total)}` });
      for (const k of ["pivot", "detalle", "impagas", "cta-cte", "actividad", "m-resumen", "sin-carga"]) void queryClient.invalidateQueries({ queryKey: [k] });
      onCerrar();
    } catch {
      setError("Error de red: no se guardó.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="pb-6">
      <span className={lbl}>Período</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => elegirPeriodo(moverPeriodo(periodo, -1))} className="size-11 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center"><ChevronLeft className="size-5" /></button>
        <div className="flex-1 text-center text-[16px] font-bold">{nombrePeriodo(periodo)}</div>
        <button type="button" onClick={() => elegirPeriodo(moverPeriodo(periodo, 1))} className="size-11 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center"><ChevronRight className="size-5" /></button>
      </div>
      {cambiarFecha
        ? <input type="date" className={`${inp} mt-2`} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        : <div className="mt-1.5 text-center text-[12.5px] text-zinc-500">Fecha del gasto {dmy(fecha)} · <button type="button" onClick={() => setCambiarFecha(true)} className="text-sky-700 underline">cambiar</button></div>}

      <span className={lbl}>Concepto</span>
      {concepto ? (
        <div className="flex items-center justify-between rounded-xl border border-zinc-300 dark:border-zinc-600 px-3 py-2.5">
          <span className="min-w-0"><b className="block truncate text-[15px]">{concepto.nombre}</b><span className="text-[12px] text-zinc-500">{concepto.rubro}</span></span>
          <button type="button" onClick={() => { setConcepto(null); setBusca(""); }} className="shrink-0 text-[13px] text-sky-700 underline">cambiar</button>
        </div>
      ) : (
        <>
          <input className={inp} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={maestros ? "Buscar concepto (ej. ferretería)" : "Cargando conceptos…"} />
          {opciones.map((c) => (
            <button key={c.codigo} type="button" onClick={() => { setConcepto(c); setBusca(""); }} className="block w-full border-b border-zinc-100 dark:border-zinc-800 py-2.5 text-left text-[15px]">
              {c.nombre} <span className="text-[12px] text-zinc-500">· {c.rubro}</span>
            </button>
          ))}
        </>
      )}

      <span className={lbl}>Detalle</span>
      <input className={inp} value={detalle} maxLength={200} onChange={(e) => setDetalle(e.target.value)} placeholder="Opcional (ej. flete, cerrajero)" />

      <span className={lbl}>Importe</span>
      <input inputMode="decimal" className={`${inp} text-right text-[18px] font-bold`} value={importeTxt} placeholder="0,00"
        onChange={(e) => setImporteTxt(e.target.value.replace(/[^\d.,]/g, ""))} />

      <label className="mt-4 flex items-center gap-2.5 text-[15px] font-semibold">
        <input type="checkbox" checked={pagado} onChange={(e) => setPagado(e.target.checked)} className="size-5" />
        Pagado
      </label>
      {pagado ? (
        <div className="grid grid-cols-2 gap-2">
          <div><span className={lbl}>Medio</span>
            <select className={inp} value={medio || medios[0]?.nombre || ""} onChange={(e) => setMedio(e.target.value)}>
              {medios.map((m) => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
            </select></div>
          <div><span className={lbl}>Fecha de pago</span><input type="date" className={inp} value={fechaPago} onChange={(e) => e.target.value && setFechaPago(e.target.value)} /></div>
        </div>
      ) : <p className="mt-1 text-[12.5px] text-zinc-500">Queda impago: aparece en Impagas y se paga después.</p>}

      {parecido && (
        <div className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-[13px] text-amber-800">
          Ya hay un gasto parecido: {dmy(parecido.fecha)} · {$(parecido.importe)}{parecido.observac ? ` · ${parecido.observac}` : ""} ({parecido.origen === "lazarillo" ? "cargado en Lazarillo" : "de MaxiRest"}).
          <div className="mt-2 flex gap-4">
            <button type="button" onClick={() => { setParecido(null); void guardar(true); }} className="font-bold underline">Es otro, cargarlo</button>
            <button type="button" onClick={() => setParecido(null)} className="text-zinc-500">No</button>
          </div>
        </div>
      )}
      {error && <div className="mt-3 rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2 text-[13px] text-red-700">{error}</div>}
      <button type="button" disabled={guardando} onClick={() => void guardar(false)}
        className="mt-4 h-12 w-full rounded-2xl bg-zinc-900 text-[15px] font-bold text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900">
        {guardando ? "Guardando…" : "Guardar gasto"}
      </button>
      <button type="button" onClick={onCerrar} className="mt-2 h-11 w-full rounded-2xl border border-zinc-300 dark:border-zinc-600 text-[15px]">Cancelar</button>
    </div>
  );
}
