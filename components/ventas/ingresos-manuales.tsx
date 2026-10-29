"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { diasEntre, itemsDeGrilla, type ItemIngreso, type ModoColumnas } from "@/lib/ventas-manuales/carga";

// Ingresos cargados a mano en Ventas (Diego 29/10/2026, mockup_ingresos_manuales_v2): facturas
// que no están en el PDV o días en que el PDV falló. Tipo y forma de cobro opcionales.

type Item = { rowId: string; fecha: string; tipo: string | null; cobro: string | null; importe: number; detalle: string | null; cliente: string | null };
type Resp = { items: Item[]; solapadas: { fecha: string; manual: number; real: number }[]; tipos: string[]; cobros: string[] };

const $ = (n: number) => "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const diaCorto = (iso: string) => `${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** "1.250.000,50" → 1250000.5 */
export const parseImporte = (s: string) => {
  const t = s.replace(/[$\s]/g, "");
  if (!t) return NaN;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/\.(?=\d{3}(\.|$))/g, ""));
};
const fmtTipeo = (s: string) => s.replace(/[^\d,.-]/g, "");
const hoy = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export function useIngresosManuales(pdvId: number | null | undefined) {
  return useFetchQuery<Resp>(["ventas-manuales", pdvId ?? null], pdvId ? `/api/ventas-manuales?pdvId=${pdvId}` : null, { staleTime: 60_000 });
}

/** Barra arriba de la tabla de Ventas: botón + aviso si hay días con carga manual y ventas reales. */
export function BarraIngresosManuales({ pdvId }: { pdvId: number | null | undefined }) {
  const { data } = useIngresosManuales(pdvId);
  const [abierto, setAbierto] = useState(false);
  if (!pdvId) return null;
  const sol = data?.solapadas ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-2.5 pb-1">
      <button type="button" onClick={() => setAbierto(true)}
        className="inline-flex h-7 items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 text-xs font-medium hover:bg-zinc-50">
        <Plus className="h-3.5 w-3.5" /> Cargar ingreso
      </button>
      {sol.length > 0 && (
        <button type="button" onClick={() => setAbierto(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-xs font-medium text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" /> {sol.length} día{sol.length === 1 ? "" : "s"} con carga manual y ventas de MaxiRest · revisar
        </button>
      )}
      {abierto && <ModalIngresos pdvId={pdvId} data={data} onClose={() => setAbierto(false)} />}
    </div>
  );
}

function ModalIngresos({ pdvId, data, onClose }: { pdvId: number; data: Resp | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const [modo, setModo] = useState<"suelto" | "dias">("suelto");
  const [errores, setErrores] = useState<string[]>([]);
  const [repetidos, setRepetidos] = useState<ItemIngreso[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const tipos = data?.tipos ?? [];
  const cobros = data?.cobros ?? [];

  // Suelto
  const [fecha, setFecha] = useState(hoy());
  const [importe, setImporte] = useState("");
  const [tipo, setTipo] = useState("");
  const [cobro, setCobro] = useState("");
  const [detalle, setDetalle] = useState("");
  const [cliente, setCliente] = useState("");

  // Varios días
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [columnas, setColumnas] = useState<ModoColumnas>("tipo");
  const [celdas, setCeldas] = useState<Record<string, Record<string, string>>>({});
  const [detalleDias, setDetalleDias] = useState("");
  const dias = useMemo(() => diasEntre(desde, hasta), [desde, hasta]);
  const cols = columnas === "tipo" ? (tipos.length ? tipos : ["SALON"]) : columnas === "cobro" ? (cobros.length ? cobros : ["EFECTIVO"]) : ["total"];
  const totalDia = (d: string) => cols.reduce((s, c) => s + (parseImporte(celdas[d]?.[c] ?? "") || 0), 0);
  const itemsDias = useMemo(() => itemsDeGrilla(columnas, Object.fromEntries(dias.map((d) => [d, Object.fromEntries(cols.map((c) => [c, celdas[d]?.[c] ?? ""]))])), parseImporte, detalleDias.trim() || null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dias, columnas, celdas, detalleDias, cols.join("|")]);
  const diasConCarga = new Set(itemsDias.map((i) => i.fecha)).size;

  async function guardar(forzar = false) {
    const items: ItemIngreso[] = modo === "suelto"
      ? [{ fecha, importe: Math.round(parseImporte(importe) * 100) / 100, tipo: tipo || null, cobro: cobro || null, detalle: detalle.trim() || null, cliente: cliente.trim() || null }]
      : itemsDias;
    const faltan: string[] = [];
    if (modo === "suelto") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) faltan.push("Falta la fecha.");
      if (!(Math.abs(parseImporte(importe)) >= 0.01)) faltan.push("Poné el importe.");
    } else {
      if (!dias.length) faltan.push("Elegí desde y hasta.");
      else if (!items.length) faltan.push("No hay importes cargados en la grilla.");
    }
    if (faltan.length) { setErrores(faltan); return; }
    setErrores([]); setRepetidos(null); setGuardando(true);
    const r = await fetch("/api/ventas-manuales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdvId, items, forzar }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setGuardando(false);
    if (r?.status === 409 && d?.repetidos) { setRepetidos(d.repetidos); return; }
    if (!r?.ok) { setErrores([d?.error ?? "No se pudo guardar.", ...(d?.detalle ?? [])]); return; }
    toast.success(`${d.cargados} ingreso${d.cargados === 1 ? "" : "s"} cargado${d.cargados === 1 ? "" : "s"}`, { description: $(d.total) });
    refrescar();
    if (modo === "suelto") { setImporte(""); setDetalle(""); setCliente(""); } else { setCeldas({}); }
  }
  function refrescar() {
    for (const k of ["ventas-manuales", "pivot-ventas", "m-resumen", "m-anual", "proyeccion-ingresos", "actualizado-al"]) void qc.invalidateQueries({ queryKey: [k] });
  }
  async function borrar(ids: string[]) {
    if (!ids.length) return;
    const r = await fetch(`/api/ventas-manuales?pdvId=${pdvId}&ids=${encodeURIComponent(ids.join(","))}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) { toast.error("No se pudo borrar"); return; }
    toast.success(ids.length === 1 ? "Ingreso borrado" : `${ids.length} ingresos borrados`);
    refrescar();
  }

  const sol = data?.solapadas ?? [];
  const idsSolapados = (data?.items ?? []).filter((i) => sol.some((s) => s.fecha === i.fecha)).map((i) => i.rowId);
  const inp = "h-9 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 text-sm";
  const lab = "mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-zinc-500";
  const seg = (on: boolean) => cn("h-7 rounded-md px-2.5 text-xs font-medium", on ? "bg-white dark:bg-zinc-700 shadow-sm text-foreground" : "text-muted-foreground");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 pt-4 pb-2">
          <div><h2 className="text-lg font-semibold">Cargar ingreso</h2>
            <p className="text-xs text-muted-foreground">Ventas que no están en el PDV. Quedan marcadas MANUAL y reimportar no las toca.</p></div>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-zinc-400 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 pb-5">
          {sol.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900">
              <b>Ya llegaron ventas de MaxiRest</b> en {sol.length} día{sol.length === 1 ? "" : "s"} con carga manual: {sol.slice(0, 6).map((s) => dm(s.fecha)).join(", ")}{sol.length > 6 ? "…" : ""}. Para no contar dos veces,
              {" "}<button type="button" className="font-bold underline" onClick={() => void borrar(idsSolapados)}>borrá la carga manual de esos días</button>.
            </div>
          )}
          <div className="mb-3 inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
            <button type="button" className={seg(modo === "suelto")} onClick={() => setModo("suelto")}>Ingreso suelto</button>
            <button type="button" className={seg(modo === "dias")} onClick={() => setModo("dias")}>Varios días</button>
          </div>

          {modo === "suelto" ? (
            <div className="grid grid-cols-2 gap-2.5">
              <div><span className={lab}>Fecha</span><input type="date" className={inp} value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
              <div><span className={lab}>Importe</span><input className={cn(inp, "text-right font-semibold")} inputMode="decimal" placeholder="0,00" value={importe} onChange={(e) => setImporte(fmtTipeo(e.target.value))} /></div>
              <div><span className={lab}>Tipo <span className="font-normal normal-case text-zinc-400">· opcional</span></span>
                <Opcional valor={tipo} opciones={tipos} onCambio={setTipo} className={inp} /></div>
              <div><span className={lab}>Forma de cobro <span className="font-normal normal-case text-zinc-400">· opcional</span></span>
                <Opcional valor={cobro} opciones={cobros} onCambio={setCobro} className={inp} /></div>
              <div><span className={lab}>Detalle / comprobante</span><input className={inp} maxLength={120} value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej: FC A 0006-00000123, evento" /></div>
              <div><span className={lab}>Cliente</span><input className={inp} maxLength={80} value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-2 gap-2.5">
                <div><span className={lab}>Desde</span><input type="date" className={inp} value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
                <div><span className={lab}>Hasta</span><input type="date" className={inp} value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
              </div>
              <div className="my-2.5 flex flex-wrap items-center gap-2">
                <span className={cn(lab, "mb-0")}>Columnas</span>
                <div className="inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
                  {([["tipo", "Tipo"], ["cobro", "Forma de cobro"], ["total", "Solo total"]] as const).map(([k, t]) => (
                    <button key={k} type="button" className={seg(columnas === k)} onClick={() => { setColumnas(k); setCeldas({}); }}>{t}</button>
                  ))}
                </div>
              </div>
              {dias.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-[11px] text-zinc-500">
                      <th className="py-1.5 text-left font-medium">Día</th>
                      {cols.map((c) => <th key={c} className="px-1 py-1.5 text-right font-medium">{c === "total" ? "Total del día" : c}</th>)}
                      {cols.length > 1 && <th className="py-1.5 text-right font-medium">Total</th>}
                    </tr></thead>
                    <tbody>
                      {dias.map((d) => (
                        <tr key={d} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="whitespace-nowrap py-1 pr-2 text-[13px]">{diaCorto(d)}</td>
                          {cols.map((c) => (
                            <td key={c} className="px-1 py-1">
                              <input className="h-8 w-full min-w-[90px] rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-right text-[13px] tabular-nums" inputMode="decimal"
                                value={celdas[d]?.[c] ?? ""} onChange={(e) => setCeldas((x) => ({ ...x, [d]: { ...(x[d] ?? {}), [c]: fmtTipeo(e.target.value) } }))} />
                            </td>
                          ))}
                          {cols.length > 1 && <td className="whitespace-nowrap py-1 pl-2 text-right text-[13px] font-semibold tabular-nums">{totalDia(d) ? $(totalDia(d)) : "—"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="py-3 text-sm text-muted-foreground">Elegí el rango de días (hasta 62).</p>}
              <div className="mt-2.5"><span className={lab}>Detalle (para todos)</span>
                <input className={inp} maxLength={120} value={detalleDias} onChange={(e) => setDetalleDias(e.target.value)} placeholder="Ej: PDV caído, totales del cierre de caja" /></div>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">{columnas === "tipo" ? "Forma de cobro: queda sin especificar." : columnas === "cobro" ? "Tipo: queda sin especificar." : "Tipo y forma de cobro quedan sin especificar."}</p>
            </div>
          )}

          {errores.length > 0 && <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{errores.map((e, i) => <div key={i}>• {e}</div>)}</div>}
          {repetidos && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Ya hay {repetidos.length === 1 ? "un ingreso igual cargado" : `${repetidos.length} ingresos iguales cargados`} ({repetidos.slice(0, 4).map((r) => `${dm(r.fecha)} ${$(r.importe)}`).join(", ")}{repetidos.length > 4 ? "…" : ""}). No se guardó nada.
              {" "}¿Son otros? <button type="button" className="font-bold underline" onClick={() => void guardar(true)}>Cargar igual</button>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={guardando} onClick={() => void guardar()} className="h-9 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">
              {guardando ? "Guardando…" : modo === "suelto" ? "Guardar" : `Guardar ${diasConCarga} día${diasConCarga === 1 ? "" : "s"}`}
            </button>
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-zinc-200 px-4 text-sm">Cerrar</button>
          </div>

          {(data?.items.length ?? 0) > 0 && (
            <div className="mt-5">
              <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-zinc-500">Cargados a mano</div>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-zinc-100 dark:border-zinc-800">
                {data!.items.map((i) => (
                  <div key={i.rowId} className={cn("flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 px-3 py-1.5 text-[13px] last:border-0", sol.some((s) => s.fecha === i.fecha) && "bg-amber-50/70")}>
                    <span className="w-20 shrink-0 tabular-nums text-zinc-500">{dm(i.fecha)}</span>
                    <span className="min-w-0 flex-1 truncate">{[i.tipo, i.cobro].filter(Boolean).join(" · ") || "Sin especificar"}{i.detalle ? <span className="text-zinc-400"> · {i.detalle}</span> : null}</span>
                    <b className="tabular-nums">{$(i.importe)}</b>
                    <button type="button" title="Borrar" onClick={() => void borrar([i.rowId])} className="rounded p-1 text-zinc-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Select con "—" (sin especificar), las opciones del PDV y "Otro…" para escribir uno nuevo.
function Opcional({ valor, opciones, onCambio, className }: { valor: string; opciones: string[]; onCambio: (v: string) => void; className: string }) {
  const [otro, setOtro] = useState(false);
  if (otro || (valor && !opciones.includes(valor))) {
    return <input className={className} autoFocus maxLength={40} value={valor} placeholder="Escribilo" onChange={(e) => onCambio(e.target.value.toUpperCase())}
      onBlur={() => { if (!valor) setOtro(false); }} />;
  }
  return (
    <select className={className} value={valor} onChange={(e) => { if (e.target.value === "__otro") { setOtro(true); onCambio(""); } else onCambio(e.target.value); }}>
      <option value="">—</option>
      {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value="__otro">Otro…</option>
    </select>
  );
}
