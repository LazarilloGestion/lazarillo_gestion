"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Upload } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { fmtPesos } from "@/lib/impagas/clasificar";
import { nombrePeriodo } from "@/lib/gastos-varios/periodo";
import { PDV_ARCA } from "@/lib/arca/clasificar";
import type { Diagnostico, FilaComprobante } from "@/lib/arca/corregir";

// "Sin carga ARCA" y "Corregir" (Diego 28/10/2026): lo que ARCA dice que te facturaron y no
// está cargado, y lo cargado que no coincide con ARCA. ARCA entra subiendo el CSV de
// "Mis Comprobantes → Recibidos"; se puede subir las veces que haga falta (no duplica).

export interface CompArca {
  key: string; mes: string; cuit: string; emisor: string | null; proveedorId: number | null; proveedor: string | null;
  tipo: number; etiqueta: string; tipoModal: string; nc: boolean; puntoVenta: number; numero: number; fecha: string; total: number;
}
export interface ACorregir {
  key: string; motivo: "importe" | "numero" | "fecha" | "duplicado"; detalle: string; arca: CompArca;
  panel: { comprobante: string; localId: number; local: string | null; rowId: string; total: number; fecha: string };
  dif: number;
  grupos: { comprobante: string; filas: FilaComprobante[] }[];
  sugerida: string | null;
  diag: Diagnostico | null;
}
export interface CruceArca {
  importado: { n: number; desde: string; hasta: string; ultima: string } | null;
  ok: number; faltan: CompArca[]; corregir: ACorregir[];
  descartes: { id: number; clave: string; nombre: string | null; creadoEn: string }[];
  anuladas: { rowId: string; comprobante: string | null; proveedor: string | null; fecha: string | null; importe: number | null; actualizadaEn: string }[];
}

export const ARCA_KEY = ["arca-cruce"];
export const useCruceArca = (activo: boolean) => useFetchQuery<CruceArca>(ARCA_KEY, activo ? "/api/arca/cruce" : null, { staleTime: 120_000 });

const dmy = (f: string) => f.slice(0, 10).split("-").reverse().join("/");
export const nroArca = (c: CompArca) => `${c.etiqueta} ${String(c.puntoVenta).padStart(4, "0")}-${String(c.numero).padStart(8, "0")}`;
export const nombreArca = (c: CompArca) => c.proveedor ?? c.emisor ?? c.cuit;

/** Contexto del modal de carga para un comprobante de ARCA, y el aviso que va arriba. */
export function ctxArca(c: CompArca) {
  return {
    ctx: { proveedorId: c.proveedorId ?? undefined, tipoCpb: c.tipoModal, prefijo: String(c.puntoVenta).padStart(4, "0"), numero: String(c.numero).padStart(8, "0"), fecha: c.fecha },
    aviso: `Viene de ARCA: ${c.emisor ?? c.cuit} · ${nroArca(c)} del ${dmy(c.fecha)} por ${fmtPesos(c.total)}.${c.proveedorId ? "" : " Este CUIT no tiene proveedor en el Panel: elegilo o dalo de alta."}`,
  };
}

async function marcar(clave: string, nombre: string) {
  const r = await fetch("/api/sin-carga/descartes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdvId: PDV_ARCA, clave, nombre }) });
  return r.ok;
}

export function SubirArca({ data }: { data: CruceArca | undefined }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  async function subir(files: FileList | null) {
    if (!files?.length) return;
    setSubiendo(true);
    try {
      for (const f of Array.from(files)) {
        if (!/\.csv$/i.test(f.name)) { toast.error(`${f.name}: tiene que ser el CSV (si bajó un .zip, descomprimilo).`); continue; }
        const r = await fetch("/api/arca/importar", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await f.text() });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { toast.error(j.error ?? `No se pudo subir ${f.name}`); continue; }
        toast.success(`ARCA: ${j.nuevos} nuevos, ${j.actualizados} ya estaban`, { description: `${dmy(j.desde)} al ${dmy(j.hasta)}${j.errores?.length ? ` · ${j.errores.length} filas sin leer` : ""}` });
      }
      await queryClient.invalidateQueries({ queryKey: ARCA_KEY });
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  }
  const i = data?.importado;
  return (
    <div className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 bg-sky-50/60 dark:bg-sky-950/20 px-6 py-2.5 text-xs">
      <span className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300">
        {i ? <>ARCA: <b>{i.n.toLocaleString("es-AR")}</b> comprobantes del {dmy(i.desde)} al {dmy(i.hasta)} · último CSV subido el {dmy(i.ultima)}</>
          : <>Todavía no subiste comprobantes de ARCA. Bajalos de <b>Mis Comprobantes → Recibidos</b> (exportar CSV) y subilos acá.</>}
      </span>
      <input ref={input} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={(e) => void subir(e.target.files)} />
      <button type="button" disabled={subiendo} onClick={() => input.current?.click()}
        className="flex h-7 items-center gap-1.5 rounded-md bg-sky-600 px-2.5 font-semibold text-white disabled:opacity-50">
        <Upload className="h-3.5 w-3.5" />{subiendo ? "Subiendo…" : "Subir CSV de ARCA"}
      </button>
    </div>
  );
}

export function ListaArca({ data, onCargar }: { data: CruceArca; onCargar: (c: CompArca) => void }) {
  const queryClient = useQueryClient();
  const meses = new Map<string, CompArca[]>();
  for (const c of data.faltan) meses.set(c.mes, [...(meses.get(c.mes) ?? []), c]);
  const orden = [...meses.keys()].sort().reverse();
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set(orden.slice(0, 1)));
  async function noVa(c: CompArca) {
    if (!(await marcar(`a:${c.key}`, `${nombreArca(c)} · ${nroArca(c)}`))) { toast.error("No se pudo marcar"); return; }
    toast.success(`${nombreArca(c)}: no se carga`, { description: "Lo volvés a mostrar desde \"Ya no van\"." });
    void queryClient.invalidateQueries({ queryKey: ARCA_KEY });
  }
  if (!orden.length) return <p className="p-6 text-sm text-muted-foreground">Todo lo que está en ARCA está cargado.</p>;
  return (
    <>
      {orden.map((mes) => {
        const items = meses.get(mes)!;
        const abierto = abiertos.has(mes);
        return (
          <div key={mes}>
            <button type="button" onClick={() => setAbiertos((s) => { const n = new Set(s); if (n.has(mes)) n.delete(mes); else n.add(mes); return n; })}
              className="flex w-full items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-6 py-2.5 text-left text-sm font-semibold">
              {abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {nombrePeriodo(mes)}
              <span className="ml-auto font-normal text-muted-foreground">{items.length} sin cargar · {fmtPesos(items.reduce((s, c) => s + (c.nc ? -c.total : c.total), 0))}</span>
            </button>
            {abierto && items.map((c) => (
              <div key={c.key} className="grid grid-cols-[1fr_170px_120px_auto] items-center gap-3 border-b border-zinc-50 dark:border-zinc-800 px-6 pl-10 py-1.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{nombreArca(c)}</span>
                  <span className="block truncate text-[11px] text-zinc-400">{c.proveedor ? (c.emisor && c.emisor !== c.proveedor ? c.emisor : `CUIT ${c.cuit}`) : <span className="text-amber-600">sin proveedor en el Panel · CUIT {c.cuit}</span>}</span>
                </span>
                <span className="text-xs text-zinc-500">{nroArca(c)} · {dmy(c.fecha).slice(0, 5)}</span>
                <span className={cn("text-right font-semibold tabular-nums", c.nc && "text-emerald-700")}>{c.nc ? "−" : ""}{fmtPesos(c.total)}</span>
                <span className="flex gap-1.5">
                  <button type="button" onClick={() => onCargar(c)} className="h-7 rounded-md bg-zinc-900 px-2.5 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900">Cargar</button>
                  <button type="button" onClick={() => void noVa(c)} title="No es un gasto del negocio o no se carga en el Panel" className="h-7 rounded-md border border-zinc-300 dark:border-zinc-600 px-2.5 text-xs font-semibold">No va</button>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

async function corregir(body: unknown) {
  const r = await fetch("/api/arca/corregir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "No se pudo corregir");
  return j;
}

/** Fecha y número distintos se ajustan solos (Diego 28/10: "lo ajusta y fin"). Corre al ver el cruce. */
export function useAjusteAutomatico(data: CruceArca | undefined) {
  const queryClient = useQueryClient();
  const hecho = useRef(false);
  useEffect(() => {
    if (!data || hecho.current) return;
    const fechas = data.corregir.filter((c) => c.motivo === "fecha");
    const numeros = data.corregir.filter((c) => c.motivo === "numero");
    if (!fechas.length && !numeros.length) return;
    hecho.current = true;
    void (async () => {
      try {
        const itemsFecha = fechas.map((c) => ({
          rowIds: c.grupos.flatMap((g) => g.filas.map((f) => f.rowId)).slice(0, 30), fecha: c.arca.fecha, key: c.key,
          nombre: `${nombreArca(c.arca)} · ${c.panel.comprobante}: fecha de ARCA ${dmy(c.arca.fecha)} (estaba ${dmy(c.panel.fecha)})`,
        })).filter((x) => x.rowIds.length);
        if (itemsFecha.length) await corregir({ accion: "fecha", items: itemsFecha });
        if (numeros.length) await corregir({ accion: "numero", items: numeros.map((c) => ({
          key: c.key, nombre: `${nombreArca(c.arca)} · cargada ${c.panel.comprobante} = ARCA ${nroArca(c.arca)}`,
        })) });
        toast.success(`Ajusté con ARCA ${itemsFecha.length} fecha${itemsFecha.length === 1 ? "" : "s"} y ${numeros.length} número${numeros.length === 1 ? "" : "s"}`, { description: "Quedan anotadas en \"Ya no van\"." });
        refrescarTodo(queryClient);
      } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo ajustar"); }
    })();
  }, [data, queryClient]);
}

function refrescarTodo(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ARCA_KEY });
  for (const k of ["dashboard", "compras", "sin-carga", "impagas", "m-resumen"]) void queryClient.invalidateQueries({ queryKey: [k] });
}

const MOTIVOS: { m: ACorregir["motivo"]; t: string; d: string }[] = [
  { m: "duplicado", t: "Cargadas dos veces", d: "En ARCA hay una sola, en el Panel dos (casi siempre una versión vieja que MaxiRest ya no tiene). Anulá la que sobra: queda en $0, no se borra." },
  { m: "importe", t: "Importe distinto", d: "Qué parte no cierra: neto + IVA (Caja y renglones) o percepciones." },
  { m: "numero", t: "Número distinto", d: "Se vinculan solas con ARCA." },
  { m: "fecha", t: "Fecha distinta", d: "Toman solas la fecha de ARCA." },
];

const $f = (n: number) => fmtPesos(n);

export function ListaCorregir({ data, onVer }: { data: CruceArca; onVer: (rowId: string, detalle: string) => void }) {
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState<string | null>(null);
  async function hacer(key: string, body: unknown, ok: string) {
    setOcupado(key);
    try { await corregir(body); toast.success(ok); refrescarTodo(queryClient); }
    catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo"); }
    finally { setOcupado(null); }
  }
  async function estaBien(c: ACorregir) {
    if (!(await marcar(`k:${c.key}`, `${nombreArca(c.arca)} · ${c.panel.comprobante} (${c.detalle})`))) { toast.error("No se pudo marcar"); return; }
    toast.success("Marcada como revisada");
    void queryClient.invalidateQueries({ queryKey: ARCA_KEY });
  }
  const visibles = data.corregir.filter((c) => c.motivo === "duplicado" || c.motivo === "importe");
  if (!visibles.length) return <p className="p-6 text-sm text-muted-foreground">No hay nada para corregir.</p>;
  return (
    <div className="space-y-3 p-4">
      {MOTIVOS.filter((x) => x.m === "duplicado" || x.m === "importe").map(({ m, t, d }) => {
        const items = visibles.filter((c) => c.motivo === m);
        if (!items.length) return null;
        return (
          <div key={m}>
            <div className="px-1 pb-1.5 text-sm"><b>{t}</b> <span className="text-muted-foreground">· {items.length}</span>
              <div className="text-[11px] text-muted-foreground">{d}</div></div>
            <div className="space-y-2.5">
              {items.map((c) => (
                <div key={c.key} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3.5 text-sm">
                  <div className="flex items-baseline gap-2">
                    <b className="truncate">{nombreArca(c.arca)}</b>
                    <span className="text-xs text-zinc-500">{nroArca(c.arca)} · {dmy(c.arca.fecha)}{c.panel.local ? ` · ${c.panel.local}` : ""}</span>
                    <span className="ml-auto shrink-0 text-xs text-zinc-500">ARCA <b className="text-zinc-800 dark:text-zinc-200">{$f(c.arca.total)}</b></span>
                  </div>
                  {c.motivo === "duplicado" ? <Duplicado c={c} ocupado={ocupado === c.key} onVer={onVer}
                      onAnular={(g) => void hacer(c.key, { accion: "anular", rowIds: g.filas.map((f) => f.rowId), nota: `Duplicado de ${nroArca(c.arca)} (ARCA)` }, `Anulada ${g.comprobante}`)} />
                    : c.diag && <Importe c={c} ocupado={ocupado === c.key} onVer={onVer}
                      onIgualar={() => c.diag?.igualar && void hacer(c.key, { accion: "igualar", rowId: c.diag.igualar.rowId, importe: c.diag.igualar.importe, key: c.key }, "Igualado a ARCA")} />}
                  <div className="mt-2 flex justify-end">
                    <button type="button" onClick={() => void estaBien(c)} className="text-xs font-semibold text-zinc-500 underline">{c.motivo === "duplicado" ? "No es duplicado" : "Está bien así"}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Duplicado({ c, ocupado, onVer, onAnular }: { c: ACorregir; ocupado: boolean; onVer: (rowId: string, d: string) => void; onAnular: (g: ACorregir["grupos"][number]) => void }) {
  return (
    <table className="mt-2 w-full text-xs">
      <thead><tr className="text-left text-[10.5px] uppercase text-zinc-400 [&>th]:px-2"><th className="py-1">Cargada como</th><th>Fecha</th><th>Concepto</th><th className="text-right">Importe</th><th className="text-center">Renglones</th><th>Pago</th><th /></tr></thead>
      <tbody>
        {c.grupos.map((g) => {
          const f0 = g.filas[0];
          const tot = g.filas.reduce((s, f) => s + f.importe, 0);
          const anulada = g.filas.length > 0 && g.filas.every((f) => f.anulada);
          const sug = c.sugerida === g.comprobante;
          return (
            <tr key={g.comprobante} className={cn("border-t border-zinc-100 dark:border-zinc-800 [&>td]:px-2", sug && "bg-amber-50/70 dark:bg-amber-950/30", anulada && "opacity-50")}>
              <td className="py-1.5 font-medium">{g.comprobante}</td>
              <td className={cn(f0 && f0.fecha !== c.arca.fecha && "font-bold text-red-700")}>{f0 ? dmy(f0.fecha).slice(0, 5) : "—"}</td>
              <td className="max-w-[160px] truncate">{g.filas.map((f) => f.concepto).filter(Boolean).join(", ")}</td>
              <td className="text-right tabular-nums">{$f(tot)}</td>
              <td className="text-center">{g.filas.reduce((s, f) => s + f.renN, 0) || "—"}</td>
              <td className={g.filas.some((f) => f.pagos > 0) ? "font-semibold text-emerald-700" : "text-red-700"}>{g.filas.some((f) => f.pagos > 0) ? "pagada" : "sin pago"}</td>
              <td className="whitespace-nowrap text-right">
                {f0 && <button type="button" onClick={() => onVer(f0.rowId, g.comprobante)} className="mr-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 px-2 py-1 font-semibold">Ver</button>}
                {anulada ? <span className="text-zinc-500">anulada</span>
                  : <button type="button" disabled={ocupado} onClick={() => onAnular(g)} className={cn("rounded-md px-2 py-1 font-semibold disabled:opacity-40", sug ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-600")}>Anular</button>}
              </td>
            </tr>
          );
        })}
      </tbody>
      {c.sugerida && <caption className="caption-bottom pt-1.5 text-left text-[11px] text-zinc-500">Sugerida para anular: la marcada (sin renglones ni pago{c.grupos.find((g) => g.comprobante === c.sugerida)?.filas[0]?.fecha !== c.arca.fecha ? ", con otra fecha" : ""}).</caption>}
    </table>
  );
}

function Importe({ c, ocupado, onVer, onIgualar }: { c: ACorregir; ocupado: boolean; onVer: (rowId: string, d: string) => void; onIgualar: () => void }) {
  const d = c.diag!;
  return (
    <>
      <table className="mt-2 w-full text-xs">
        <thead><tr className="text-left text-[10.5px] uppercase text-zinc-400 [&>th]:px-2"><th className="py-1">Parte</th><th className="text-right">ARCA</th><th className="text-right">Renglones</th><th className="text-right">Caja (14)</th></tr></thead>
        <tbody>
          {d.partes.map((p) => (
            <tr key={p.parte} className="border-t border-zinc-100 dark:border-zinc-800 [&>td]:px-2">
              <td className="py-1.5">{p.parte}</td>
              <td className="bg-sky-50/70 text-right tabular-nums dark:bg-sky-950/30">{$f(p.arca)}</td>
              <td className="text-right tabular-nums">{p.renglones == null ? "—" : $f(p.renglones)}</td>
              <td className={cn("text-right tabular-nums", p.ok ? "text-emerald-700" : "font-semibold text-red-700")}>{$f(p.caja)} {p.ok ? "✓" : "✗"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-2.5 py-2 text-xs">{d.texto}</p>
      <div className="mt-2 flex gap-1.5">
        {d.igualar && !c.arca.nc && <button type="button" disabled={ocupado} onClick={onIgualar} title={`La fila principal pasa a ${$f(d.igualar.importe)}`}
          className="h-7 rounded-md bg-zinc-900 px-2.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900">Igualar neto + IVA a ARCA</button>}
        <button type="button" onClick={() => onVer(c.panel.rowId, c.panel.comprobante)} className="h-7 rounded-md border border-zinc-300 dark:border-zinc-600 px-2.5 text-xs font-semibold">Ver / editar</button>
      </div>
    </>
  );
}
