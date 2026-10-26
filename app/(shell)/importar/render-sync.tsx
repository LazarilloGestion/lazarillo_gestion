"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, RefreshCw, CheckCircle2, AlertCircle, Clock, Ban, ChevronDown } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Local } from "@/lib/types/domain";
import type { ItemRender, ResultadoCorto } from "@/lib/render/sync";

type Corrida = {
  id: number;
  inicio: string;
  fin: string | null;
  estado: "corriendo" | "ok" | "error";
  origen: string;
  total: number;
  hechos: number;
  actual: string | null;
  resumen: Record<string, ResultadoCorto | number | string> | null;
};
type Respuesta = { configurado: boolean; items: ItemRender[]; corrida: Corrida | null; error?: string };

const fmtFechaHora = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
};
const fmtN = (n: number) => n.toLocaleString("es-AR");

// Leído después de la última carga del kit = al día.
function alDia(it: ItemRender): boolean {
  return !!it.ultimo && it.ultimo.estado === "ok" && new Date(it.ultimo.creadoEn) >= new Date(it.cargadoEnRender);
}

function Estado({ it, res, leyendo }: { it: ItemRender; res?: ResultadoCorto; leyendo: boolean }) {
  if (leyendo) return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner size="sm" /> Leyendo…</span>;
  if (res?.startsWith("error:")) return <span className="inline-flex items-center gap-1 text-xs text-destructive" title={res.slice(6)}><AlertCircle className="h-3.5 w-3.5" /> Error</span>;
  if (res === "sin_cambios") return <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Sin cambios</span>;
  if (res === "leido" && it.ultimo) return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> {fmtN(it.ultimo.created ?? 0)} nuevos · {fmtN(it.ultimo.updated ?? 0)} actualizados
    </span>
  );
  if (res === "leido") return <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Leído</span>;
  if (it.bloqueado) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={it.bloqueado}><Ban className="h-3.5 w-3.5" /> Por ahora desde Drive</span>;
  if (it.ultimo?.estado === "error") return <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" /> Error {fmtFechaHora(it.ultimo.creadoEn)}</span>;
  if (alDia(it)) return <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Leído {fmtFechaHora(it.ultimo!.creadoEn)}</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-amber-700"><Clock className="h-3.5 w-3.5" /> Pendiente</span>;
}

// La lectura corre en el SERVIDOR (Diego, 26/10/2026: poder cambiar de pantalla
// mientras actualiza). Acá solo se larga y se muestra el avance, preguntando cada 3 s.
export function RenderSync() {
  const queryClient = useQueryClient();
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const nombrePdv = (localId: number, pdvId: number) => {
    if (!localId) return "Maestros de la organización";
    const l = locales?.find((x) => x.id === localId);
    const p = l?.puntosDeVenta.find((x) => x.id === pdvId);
    return l ? (p ? `${l.nombre} · ${p.nombre}` : l.nombre) : `Local ${localId}`;
  };
  const q = useQuery<Respuesta>({
    queryKey: ["render-items"],
    queryFn: async () => (await fetch("/api/etl/render")).json(),
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.corrida?.estado === "corriendo" ? 3000 : false),
  });
  const [lanzando, setLanzando] = useState(false);
  // Minimizada por defecto (Diego 26/10: "ocupa mucho espacio"); se recuerda en el navegador.
  const [abierta, setAbierta] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferencia guardada en este navegador
      if (localStorage.getItem("render-sync-abierta") === "1") setAbierta(true);
    } catch { /* sin storage: queda minimizada */ }
  }, []);
  function alternar() {
    setAbierta((a) => {
      try { localStorage.setItem("render-sync-abierta", a ? "0" : "1"); } catch { /* sin storage */ }
      return !a;
    });
  }

  const corrida = q.data?.corrida ?? null;
  const corriendo = corrida?.estado === "corriendo";
  // Al terminar una corrida que se vio en curso, se refrescan las vistas que dependen de los datos.
  const venia = useRef(false);
  useEffect(() => {
    if (venia.current && !corriendo) {
      void queryClient.invalidateQueries({ queryKey: ["pivot"] });
      void queryClient.invalidateQueries({ queryKey: ["detalle"] });
      void queryClient.invalidateQueries({ queryKey: ["actualizado-al"] });
    }
    venia.current = corriendo;
  }, [corriendo, queryClient]);
  const resultadoDe = (it: ItemRender): ResultadoCorto | undefined => {
    const r = corrida?.resumen?.[it.id];
    return typeof r === "string" ? (r as ResultadoCorto) : undefined;
  };
  const leyendo = (it: ItemRender) => corriendo && corrida?.actual === `${it.nombre} · ${it.pdv}`;

  const items = q.data?.items ?? [];
  // Resumen para la tarjeta minimizada.
  const resumen = (() => {
    let ok = 0, pend = 0, err = 0, drive = 0;
    for (const it of items) {
      const r = resultadoDe(it);
      if (it.bloqueado) drive++;
      else if (r?.startsWith("error:") || (!r && it.ultimo?.estado === "error")) err++;
      else if (r || alDia(it)) ok++;
      else pend++;
    }
    return { ok, pend, err, drive };
  })();
  const grupos = new Map<string, ItemRender[]>();
  for (const it of items) {
    const k = `${it.localId}|${it.puntoDeVentaId}`;
    grupos.set(k, [...(grupos.get(k) ?? []), it]);
  }

  async function actualizar() {
    setLanzando(true);
    try {
      const res = await fetch("/api/etl/render/correr", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) toast.error(d?.error ?? "No se pudo arrancar la actualización");
      else if (d?.yaCorriendo) toast.info("Ya se está actualizando: te muestro el avance");
      else toast.success("Actualizando en el servidor: podés cambiar de pantalla");
    } catch {
      toast.error("Error de red");
    } finally {
      setLanzando(false);
      await queryClient.invalidateQueries({ queryKey: ["render-items"] });
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden">
      <div className={cn("flex items-center justify-between gap-3 px-4 py-3", abierta && "border-b border-zinc-100 dark:border-zinc-700/50")}>
        <button type="button" onClick={alternar} aria-expanded={abierta} className="flex items-center gap-2 min-w-0 text-left">
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !abierta && "-rotate-90")} />
          <Database className="h-4 w-4 text-sky-600 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Desde Render · automático</div>
            <div className="text-xs text-muted-foreground truncate">
              {corriendo ? (
                <span className="text-sky-700">
                  Actualizando en el servidor · {corrida!.hechos} de {corrida!.total}
                  {corrida!.actual ? ` · ${corrida!.actual}` : ""} — podés cambiar de pantalla
                </span>
              ) : abierta || !q.data?.configurado || items.length === 0 ? (
                "El kit sube los informes cada mañana y el Panel los lee solo a las 9:40. Lo que no cambió se saltea."
              ) : (
                <>
                  <span className="text-emerald-700">{resumen.ok} al día</span>
                  {resumen.pend > 0 && <span className="text-amber-700"> · {resumen.pend} pendientes</span>}
                  {resumen.err > 0 && <span className="text-destructive"> · {resumen.err} con error</span>}
                  {resumen.drive > 0 && <> · {resumen.drive} por Drive</>}
                </>
              )}
            </div>
          </div>
        </button>
        {q.data?.configurado && items.length > 0 && (
          <button
            type="button"
            onClick={() => actualizar()}
            disabled={corriendo || lanzando}
            className="inline-flex shrink-0 items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {corriendo || lanzando ? <Spinner size="sm" className="text-primary-foreground" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Actualizar ahora
          </button>
        )}
      </div>

      {!abierta ? null : q.isLoading ? (
        <div className="px-4 py-6 flex justify-center"><Spinner /></div>
      ) : !q.data?.configurado ? (
        <div className="px-4 py-3 text-xs text-amber-800 bg-amber-50 dark:bg-amber-950/30">
          Falta conectar Render: cargá la variable RENDER_DATABASE_URL en Vercel. Mientras tanto se importa desde Drive.
        </div>
      ) : q.data.error ? (
        <div className="px-4 py-3 text-xs text-destructive">{q.data.error}</div>
      ) : items.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">No hay puntos de venta vinculados a Render.</div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
          {[...grupos.entries()].map(([k, its]) => (
            <div key={k} className="px-4 py-2.5">
              <div className="mb-1.5 text-xs font-medium text-foreground">
                {nombrePdv(its[0].localId, its[0].puntoDeVentaId)}
                <span className="ml-1.5 font-normal text-muted-foreground">({its[0].pdv})</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_12rem_13rem] items-center gap-x-4 gap-y-1">
                {its.map((it) => (
                  <div key={it.id} className="contents">
                    <span className="truncate text-xs">{it.nombre}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums text-right">
                      kit {fmtFechaHora(it.cargadoEnRender)} · {fmtN(it.filas)} filas
                    </span>
                    <span>
                      <Estado it={it} res={resultadoDe(it)} leyendo={leyendo(it)} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
