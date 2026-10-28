"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Upload } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { fmtPesos } from "@/lib/impagas/clasificar";
import { nombrePeriodo } from "@/lib/gastos-varios/periodo";
import { PDV_ARCA } from "@/lib/arca/clasificar";

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
}
export interface CruceArca {
  importado: { n: number; desde: string; hasta: string; ultima: string } | null;
  ok: number; faltan: CompArca[]; corregir: ACorregir[];
  descartes: { id: number; clave: string; nombre: string | null; creadoEn: string }[];
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

const MOTIVOS: { m: ACorregir["motivo"]; t: string; d: string }[] = [
  { m: "duplicado", t: "Cargadas dos veces", d: "El mismo comprobante está cargado con dos nombres en el mismo local." },
  { m: "numero", t: "Número distinto", d: "En ARCA no está con ese número, pero hay uno del mismo proveedor e importe." },
  { m: "importe", t: "Importe distinto", d: "El total cargado no coincide con ARCA (más del 1%)." },
  { m: "fecha", t: "Fecha distinta", d: "Más de 3 días de diferencia con ARCA." },
];

export function ListaCorregir({ data, onVer }: { data: CruceArca; onVer: (rowId: string, detalle: string) => void }) {
  const queryClient = useQueryClient();
  async function estaBien(c: ACorregir) {
    if (!(await marcar(`k:${c.key}`, `${nombreArca(c.arca)} · ${c.panel.comprobante} (${c.detalle})`))) { toast.error("No se pudo marcar"); return; }
    toast.success("Marcada como revisada");
    void queryClient.invalidateQueries({ queryKey: ARCA_KEY });
  }
  if (!data.corregir.length) return <p className="p-6 text-sm text-muted-foreground">No hay nada para corregir.</p>;
  return (
    <>
      {MOTIVOS.map(({ m, t, d }) => {
        const items = data.corregir.filter((c) => c.motivo === m);
        if (!items.length) return null;
        return (
          <div key={m}>
            <div className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-6 py-2.5 text-sm">
              <b>{t}</b> <span className="text-muted-foreground">· {items.length}</span>
              <div className="text-[11px] text-muted-foreground">{d}</div>
            </div>
            {items.map((c) => (
              <div key={c.key} className="grid grid-cols-[1fr_1.3fr_auto] items-center gap-3 border-b border-zinc-50 dark:border-zinc-800 px-6 pl-10 py-1.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{nombreArca(c.arca)}</span>
                  <span className="block truncate text-[11px] text-zinc-400">{c.panel.comprobante} · {dmy(c.panel.fecha)}{c.panel.local ? ` · ${c.panel.local}` : ""}</span>
                </span>
                <span className="text-xs text-red-700 dark:text-red-400">{c.detalle}</span>
                <span className="flex gap-1.5">
                  <button type="button" onClick={() => onVer(c.panel.rowId, c.panel.comprobante)} className="h-7 rounded-md bg-zinc-900 px-2.5 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900">Ver</button>
                  <button type="button" onClick={() => void estaBien(c)} title="Ya lo revisé: está bien así" className="h-7 rounded-md border border-zinc-300 dark:border-zinc-600 px-2.5 text-xs font-semibold">Está bien</button>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
