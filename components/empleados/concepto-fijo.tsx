"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tag, X } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { AperturaVigenciaSelector, type VigenciaFormState } from "@/components/dashboard/apertura-vigencia-selector";
import { describirPeriodo, errorVigencia, type ReglaConceptoEmpleado } from "@/lib/empleados/concepto-fijo";

// Concepto fijo por empleado (Diego 29/10/2026, mockup_concepto_fijo_empleado): botón 🏷 al lado
// del ⅄ en la vista Proveedor; todo lo del empleado va al concepto elegido (y su rubro), con los
// mismos períodos que las reglas de apertura.

type Regla = ReglaConceptoEmpleado & { conceptoNombre: string };
type Maestros = { conceptos: { codigo: string; nombre: string; rubro: string }[] };
type Prev = { registros: number; total: number; conceptos: { concepto: string; n: number; total: number }[] };

const $ = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");

export function useConceptosEmpleado(pdvId: number | null | undefined) {
  return useFetchQuery<{ reglas: Regla[] }>(["conceptos-empleado", pdvId ?? null], pdvId ? `/api/conceptos-empleado?pdvId=${pdvId}` : null, { staleTime: 5 * 60_000 });
}

/** Chip violeta "→ Concepto" + botón 🏷 de la fila del empleado. */
export function ConceptoFijoEmpleado({ pdvId, entidadId, nombre, reglas }: { pdvId: number | null | undefined; entidadId: string; nombre: string; reglas: Regla[] }) {
  const [abierto, setAbierto] = useState(false);
  if (!pdvId) return null;
  const suyas = reglas.filter((r) => r.entidadId === entidadId);
  return (
    <>
      {suyas.length > 0 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setAbierto(true); }} title={suyas.map((r) => `${r.conceptoNombre} · ${describirPeriodo(r)}`).join("\n")}
          className="shrink-0 truncate rounded bg-violet-100 dark:bg-violet-950 px-1.5 py-px text-[10.5px] font-semibold text-violet-700 dark:text-violet-300 max-w-[140px]">
          → {suyas[0].conceptoNombre}{suyas.length > 1 ? ` +${suyas.length - 1}` : ""}
        </button>
      )}
      <button type="button" title="Concepto fijo del empleado" onClick={(e) => { e.stopPropagation(); setAbierto(true); }}
        className={cn("shrink-0 rounded p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700", suyas.length ? "text-violet-600" : "text-muted-foreground")}>
        <Tag className="h-3.5 w-3.5" />
      </button>
      {/* Portal al body: dentro de la celda sticky de la tabla, el encabezado de la tabla (sticky,
          z-20/30) le pasaba por encima al modal (Diego 29/10). */}
      {abierto && createPortal(<Modal pdvId={pdvId} entidadId={entidadId} nombre={nombre} suyas={suyas} onClose={() => setAbierto(false)} />, document.body)}
    </>
  );
}

function Modal({ pdvId, entidadId, nombre, suyas, onClose }: { pdvId: number; entidadId: string; nombre: string; suyas: Regla[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: maestros } = useFetchQuery<Maestros>(["facturas-maestros"], "/api/facturas/maestros", { staleTime: 15 * 60_000 });
  const conceptos = useMemo(() => [...(maestros?.conceptos ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre)), [maestros]);
  const [concepto, setConcepto] = useState("");
  const [buscar, setBuscar] = useState("");
  const [vig, setVig] = useState<VigenciaFormState>({ modo: "desde_adelante", fechaDesde: "", fechaHasta: "", extremosInclusivos: true, confirmarHistorico: false });
  const [prev, setPrev] = useState<Prev | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cuerpo = useMemo(() => ({
    pdvId, entidadId, nombre, conceptoCodigo: concepto, modo: vig.modo,
    fechaDesde: vig.fechaDesde || null, fechaHasta: vig.fechaHasta || null, extremosInclusivos: vig.extremosInclusivos,
  }), [pdvId, entidadId, nombre, concepto, vig]);
  const falta = !concepto ? "Elegí el concepto." : errorVigencia(cuerpo) ?? (vig.modo === "historico" && !vig.confirmarHistorico ? "Confirmá que va a todo el histórico." : null);

  // Qué cambiaría (sin guardar), cada vez que cambia el concepto o el período.
  useEffect(() => {
    if (!concepto || errorVigencia(cuerpo)) return;
    let vivo = true;
    const t = setTimeout(() => {
      fetch("/api/conceptos-empleado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...cuerpo, previsualizar: true }) })
        .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => null) }))
        .then(({ ok, d }) => { if (!vivo) return; if (ok) { setPrev(d); setError(null); } else { setPrev(null); setError(d?.error ?? "No se pudo calcular"); } })
        .catch(() => {});
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [cuerpo, concepto]);

  function refrescar() {
    for (const k of ["conceptos-empleado", "pivot", "detalle", "m-resumen", "m-anual", "sin-carga"]) void qc.invalidateQueries({ queryKey: [k] });
  }
  async function guardar() {
    if (falta) { setError(falta); return; }
    setGuardando(true);
    const r = await fetch("/api/conceptos-empleado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setGuardando(false);
    if (!r?.ok) { setError(d?.error ?? "No se pudo guardar."); return; }
    toast.success("Concepto fijo guardado", { description: `${d.cambiados} registro${d.cambiados === 1 ? "" : "s"} cambiado${d.cambiados === 1 ? "" : "s"}` });
    refrescar(); onClose();
  }
  async function quitar(id: number) {
    const r = await fetch(`/api/conceptos-empleado?id=${id}&pdvId=${pdvId}`, { method: "DELETE" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) { toast.error("No se pudo quitar"); return; }
    toast.success("Regla quitada", { description: `${d.cambiados} registro${d.cambiados === 1 ? "" : "s"} volvieron a su concepto` });
    refrescar();
  }

  const elegido = conceptos.find((c) => c.codigo === concepto);
  const lista = conceptos.filter((c) => !buscar || `${c.nombre} ${c.rubro}`.toLowerCase().includes(buscar.toLowerCase())).slice(0, 60);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-xl font-normal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 pt-4 pb-2">
          <div><h2 className="text-lg font-semibold">Concepto fijo · {nombre}</h2>
            <p className="text-xs text-muted-foreground">Todo lo que se cargue a su nombre va a este concepto (y su rubro).</p></div>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-zinc-400 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 pb-5 text-sm">
          {suyas.length > 0 && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 dark:bg-violet-950/30 px-3 py-2">
              {suyas.map((r) => (
                <div key={r.id} className="flex items-center gap-2 py-0.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">→ <b>{r.conceptoNombre}</b> · {describirPeriodo(r)}{r.modo !== "historico" && !r.extremosInclusivos ? " (sin extremos)" : ""}</span>
                  <button type="button" onClick={() => void quitar(r.id)} className="text-xs font-semibold text-red-600 hover:underline">Quitar</button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-zinc-500">Concepto de caja</span>
              <input className="h-9 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5" placeholder={elegido ? `${elegido.nombre} · ${elegido.rubro}` : "Buscar concepto…"}
                value={buscar} onChange={(e) => setBuscar(e.target.value)} />
              {(buscar || !concepto) && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
                  {lista.map((c) => (
                    <button key={c.codigo} type="button" onClick={() => { setConcepto(c.codigo); setBuscar(""); }}
                      className={cn("flex w-full justify-between px-2.5 py-1.5 text-left text-[13px] hover:bg-zinc-50 dark:hover:bg-zinc-800", c.codigo === concepto && "bg-violet-50")}>
                      <span>{c.nombre}</span><span className="text-zinc-400">{c.rubro}</span>
                    </button>
                  ))}
                  {!lista.length && <div className="px-2.5 py-1.5 text-[13px] text-zinc-400">Sin resultados</div>}
                </div>
              )}
              {elegido && !buscar && <div className="mt-1 text-[12px] text-muted-foreground">Rubro: <b>{elegido.rubro}</b></div>}
            </div>
            <div className="relative col-span-2">
              <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-zinc-500">Período</span>
              <AperturaVigenciaSelector value={vig} onChange={setVig} />
            </div>
          </div>
          {prev && concepto && !errorVigencia(cuerpo) && (
            <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-[13px]">
              <b>{prev.registros ? `Se cambian ${prev.registros} registro${prev.registros === 1 ? "" : "s"} · ${$(prev.total)}` : "No cambia ningún registro que ya esté cargado"}</b>
              {prev.conceptos.map((c) => <div key={c.concepto}>{c.concepto} ({c.n}) → {elegido?.nombre}</div>)}
              <div className="mt-1 text-[12px] text-muted-foreground">Los que corregiste a mano no se tocan. Lo nuevo que entre de MaxiRest o del Panel ya entra con este concepto.</div>
            </div>
          )}
          {error && <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={guardando} onClick={() => void guardar()} className="h-9 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">
              {guardando ? "Guardando…" : "Guardar regla"}
            </button>
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-zinc-200 px-4 text-sm">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
