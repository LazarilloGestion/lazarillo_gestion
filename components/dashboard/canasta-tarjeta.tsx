"use client";
import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { acumulada, canastaMensual, pesoRelativo, ventanaUltimoAumento, type ClaveComponente } from "@/lib/dashboard/canasta";
import { aumentosVsCostos } from "@/lib/dashboard/aumentos";
import type { CanastaData } from "@/hooks/use-canasta";

const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const pct = (x: number | null | undefined, signo = true) =>
  x == null ? "—" : `${signo && x > 0 ? "+" : ""}${(x * 100).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const COMO: Record<ClaveComponente, string> = {
  sueldos: "mismo empleado mes a mes, sin SAC",
  mercaderias: "precio por insumo, canasta fija",
  servicios: "por proveedor × concepto",
  alquiler: "en revisión: no entra al %",
};

export interface ResumenCanasta {
  mes: number | null; tres: number | null; doce: number | null;
  desde: number | null; base: string | null; posterior: string | null; serie: (number | null)[];
}

export function resumirCanasta(d: CanastaData): ResumenCanasta {
  const serie = canastaMensual(d.componentes, d.meses.length);
  const ult = d.meses.length - 1;
  const v = ventanaUltimoAumento(d.meses, d.aumentos.map((a) => a.fecha));
  return {
    serie, mes: serie[ult], tres: acumulada(serie, ult - 2, ult), doce: acumulada(serie, 0, ult),
    desde: v.desdeIdx == null ? null : v.desdeIdx > ult ? 0 : acumulada(serie, v.desdeIdx, ult),
    base: v.base, posterior: v.posterior,
  };
}

/** Contenido de la tarjeta chica (dentro de la fila del último mes cerrado). */
export function CanastaMini({ r }: { r: ResumenCanasta }) {
  const principal = r.base ? r.desde : r.mes;
  return (
    <>
      <b className={cn("block text-[18px] tabular-nums leading-tight", (principal ?? 0) > 0 ? "text-violet-700 dark:text-violet-300" : "")}>{pct(principal)}</b>
      <div className="text-[11.5px] font-semibold leading-snug text-muted-foreground">
        {r.base ? <>desde {ddmm(r.base)} (aumento)</> : <>en el mes</>}
      </div>
      <div className="text-[11.5px] leading-snug text-muted-foreground">12 meses {pct(r.doce)}</div>
    </>
  );
}

/** Detalle a todo el ancho (al tocar la tarjeta). */
export function CanastaDetalle({ d, r, mesRef, conPdv, onAgregar, onQuitar, onDetectar, onCerrar }: {
  d: CanastaData; r: ResumenCanasta; mesRef: number; conPdv: boolean;
  onAgregar: (f: string) => void; onQuitar: (f: string) => void; onDetectar: () => Promise<void>; onCerrar: () => void;
}) {
  const [nueva, setNueva] = useState("");
  const [detectando, setDetectando] = useState(false);
  const filas = aumentosVsCostos(d.meses, r.serie, d.aumentos).filter((f) => f.costos != null);
  const ultimoAum = d.aumentos.length ? d.aumentos[d.aumentos.length - 1] : null;
  const ult = d.meses.length - 1;
  const v = ventanaUltimoAumento(d.meses, d.aumentos.map((a) => a.fecha));
  const pesos = pesoRelativo(d.componentes);
  const nombreMes = MES[mesRef - 1];
  const fila = (c: CanastaData["componentes"][number]) => {
    const desde = v.desdeIdx == null ? null : v.desdeIdx > ult ? 0 : acumulada(c.variaciones, v.desdeIdx, ult);
    return (
      <tr key={c.clave} className={cn("border-t border-violet-100 dark:border-violet-900/40", !c.cuenta && "text-muted-foreground/70")}>
        <td className="py-1.5 pr-3">{c.nombre}{!c.cuenta && <span className="ml-1.5 rounded border border-zinc-300 px-1 text-[10px]">en revisión</span>}</td>
        <td className="px-3 text-right tabular-nums">{c.cuenta ? pct(pesos.get(c.clave), false).replace(",0%", "%") : "—"}</td>
        <td className={cn("px-3 text-right tabular-nums", c.cuenta && (c.variaciones[ult] ?? 0) > 0.02 && "text-red-600")}>{pct(c.variaciones[ult])}</td>
        <td className="px-3 text-right tabular-nums">{pct(acumulada(c.variaciones, ult - 2, ult))}</td>
        <td className="px-3 text-right tabular-nums">{pct(acumulada(c.variaciones, 0, ult))}</td>
        {v.base && <td className="px-3 text-right tabular-nums">{pct(desde)}</td>}
        <td className="pl-3 text-[11.5px] text-muted-foreground">
          {COMO[c.clave]}{c.clave === "mercaderias" && c.aRevisar ? ` · ${c.aRevisar} insumos con saltos raros apartados` : ""}
        </td>
      </tr>
    );
  };
  return (
    <div className="mt-3 rounded-xl border border-violet-300 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/20 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <b className="text-[15px] text-violet-700 dark:text-violet-300">Tu canasta · {nombreMes}</b>
          <span className="text-xs text-muted-foreground">cuánto subieron TUS costos, ponderado por lo que pesa cada uno en tus gastos (últimos 6 meses)</span>
        </div>
        <button type="button" onClick={onCerrar} className="shrink-0 text-xs font-semibold text-violet-700 hover:underline">▴ cerrar</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11.5px] text-muted-foreground">
                <th className="py-1 pr-3 text-left font-medium">Componente</th>
                <th className="px-3 text-right font-medium">Peso</th>
                <th className="px-3 text-right font-medium capitalize">{nombreMes.slice(0, 3)}</th>
                <th className="px-3 text-right font-medium">3 meses</th>
                <th className="px-3 text-right font-medium">12 meses</th>
                {v.base && <th className="px-3 text-right font-medium">Desde {ddmm(v.base)}</th>}
                <th className="pl-3 text-left font-medium">Cómo se mide</th>
              </tr>
            </thead>
            <tbody>
              {d.componentes.filter((c) => c.cuenta).map(fila)}
              {d.componentes.filter((c) => !c.cuenta).map(fila)}
              <tr className="border-t-2 border-violet-200 dark:border-violet-800 font-bold text-violet-700 dark:text-violet-300">
                <td className="py-1.5 pr-3">Tu canasta</td>
                <td className="px-3 text-right">100%</td>
                <td className="px-3 text-right tabular-nums">{pct(r.mes)}</td>
                <td className="px-3 text-right tabular-nums">{pct(r.tres)}</td>
                <td className="px-3 text-right tabular-nums">{pct(r.doce)}</td>
                {v.base && <td className="px-3 text-right tabular-nums">{pct(r.desde)}</td>}
                <td className="pl-3 text-[11.5px] font-normal text-muted-foreground">mes a mes salta; mirá 3 meses o desde el aumento</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 rounded-lg bg-white/70 dark:bg-zinc-900/50 p-3 text-[13px]">
          {filas.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Cada aumento contra lo que subieron tus costos desde el anterior</div>
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-[11px] text-muted-foreground">
                  <th className="text-left font-medium">Aumento</th><th className="text-right font-medium">Carta</th>
                  <th className="text-right font-medium">Costos</th><th className="text-right font-medium">Brecha</th>
                </tr></thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.fecha} className="border-t border-violet-100 dark:border-violet-900/40">
                      <td className="py-1 tabular-nums">{ddmm(f.fecha)}{f.provisorio && <span title="Menos de 3 semanas después del aumento: el % todavía se puede mover" className="text-muted-foreground">*</span>}</td>
                      <td className="text-right tabular-nums">{pct(f.carta)}</td>
                      <td className="text-right tabular-nums" title={f.hastaMes ? `hasta ${MES[Number(f.hastaMes.slice(5)) - 1]}` : undefined}>{pct(f.costos)}{f.hastaMes && <span className="text-muted-foreground">¹</span>}</td>
                      <td className={cn("text-right font-semibold tabular-nums", f.brecha == null ? "" : f.brecha >= 0 ? "text-emerald-700" : "text-red-600")}>
                        {f.brecha == null ? "—" : `${f.brecha >= 0 ? "+" : "−"}${Math.abs(f.brecha * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} pts`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Brecha positiva = el aumento cubrió lo que subieron tus costos.{filas.some((f) => f.provisorio) && " * provisorio."}{filas.some((f) => f.hastaMes) && ` ¹ costos hasta ${nombreMes}.`}
              </div>
            </div>
          )}
          {r.base && ultimoAum && ultimoAum.fecha.slice(0, 7) <= d.meses[d.meses.length - 1] && (
            <div>Desde el {ddmm(r.base)} tus costos subieron <b className="text-violet-700 dark:text-violet-300">{pct(r.desde)}</b>: para volver al margen de entonces, <b className="text-violet-700 dark:text-violet-300">aumentar ~{pct(r.desde, false)}</b>.</div>
          )}
          {!r.base && (
            <div className="text-xs text-muted-foreground">Anotá la fecha de tu último aumento de precios (o tocá ↻ para buscarlo en el informe 12) para ver cuánto subieron tus costos desde entonces.</div>
          )}
          {conPdv && (
            <div className="mt-1 border-t border-violet-100 dark:border-violet-900/40 pt-2">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Aumentos de precios</span>
                <button type="button" disabled={detectando} title="Buscar aumentos en el informe 12 (se hace solo cada noche)"
                  onClick={async () => { setDetectando(true); await onDetectar(); setDetectando(false); }}
                  className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-muted hover:text-foreground disabled:opacity-50">
                  <RefreshCw className={cn("h-3 w-3", detectando && "animate-spin")} /> detectar
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {d.aumentos.map((a) => (
                  <span key={a.fecha} className="inline-flex h-6 items-center gap-1 rounded-md border border-violet-200 dark:border-violet-800 bg-white dark:bg-zinc-900 pl-2 pr-1 text-xs tabular-nums"
                    title={a.origen === "detectado" ? "Detectado en el informe 12" : "Cargado a mano"}>
                    {ddmm(a.fecha)}/{a.fecha.slice(2, 4)}{a.pct != null && <b className="ml-0.5 text-violet-700 dark:text-violet-300">{pct(a.pct)}{a.provisorio ? "*" : ""}</b>}
                    <button type="button" aria-label={`Quitar aumento del ${ddmm(a.fecha)}`} onClick={() => onQuitar(a.fecha)} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input type="date" value={nueva} onChange={(e) => setNueva(e.target.value)} aria-label="Fecha del aumento"
                  className="h-7 flex-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-xs" />
                <button type="button" disabled={!nueva} onClick={() => { onAgregar(nueva); setNueva(""); }}
                  className="h-7 rounded-md bg-violet-600 px-2.5 text-xs font-medium text-white disabled:opacity-40">Agregar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
