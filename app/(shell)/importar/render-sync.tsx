"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, RefreshCw, CheckCircle2, AlertCircle, Clock, Ban } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import type { Local } from "@/lib/types/domain";
import type { ItemRender, ResultadoItem } from "@/lib/render/sync";

type Respuesta = { configurado: boolean; items: ItemRender[]; error?: string };
type EstadoLocal = { corriendo?: boolean; resultado?: ResultadoItem };

const fmtFechaHora = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
};
const fmtN = (n: number) => n.toLocaleString("es-AR");

// Leído después de la última carga del kit = al día.
function alDia(it: ItemRender): boolean {
  return !!it.ultimo && it.ultimo.estado === "ok" && new Date(it.ultimo.creadoEn) >= new Date(it.cargadoEnRender);
}

function Estado({ it, local }: { it: ItemRender; local?: EstadoLocal }) {
  if (local?.corriendo) return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner size="sm" /> Leyendo…</span>;
  const r = local?.resultado;
  if (r && "error" in r) return <span className="inline-flex items-center gap-1 text-xs text-destructive" title={r.error}><AlertCircle className="h-3.5 w-3.5" /> Error</span>;
  if (r && "sinCambios" in r) return <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Sin cambios</span>;
  if (r && "report" in r) return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> {fmtN(r.report.created)} nuevos · {fmtN(r.report.updated)} actualizados
    </span>
  );
  if (it.bloqueado) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={it.bloqueado}><Ban className="h-3.5 w-3.5" /> Por ahora desde Drive</span>;
  if (it.ultimo?.estado === "error") return <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" /> Error {fmtFechaHora(it.ultimo.creadoEn)}</span>;
  if (alDia(it)) return <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Leído {fmtFechaHora(it.ultimo!.creadoEn)}</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-amber-700"><Clock className="h-3.5 w-3.5" /> Pendiente</span>;
}

export function RenderSync() {
  const queryClient = useQueryClient();
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const nombrePdv = (localId: number, pdvId: number) => {
    const l = locales?.find((x) => x.id === localId);
    const p = l?.puntosDeVenta.find((x) => x.id === pdvId);
    return l ? (p ? `${l.nombre} · ${p.nombre}` : l.nombre) : `Local ${localId}`;
  };
  const q = useQuery<Respuesta>({
    queryKey: ["render-items"],
    queryFn: async () => (await fetch("/api/etl/render")).json(),
    staleTime: 30_000,
  });
  const [estados, setEstados] = useState<Record<string, EstadoLocal>>({});
  const [corriendo, setCorriendo] = useState(false);

  const items = q.data?.items ?? [];
  const grupos = new Map<string, ItemRender[]>();
  for (const it of items) {
    const k = `${it.localId}|${it.puntoDeVentaId}`;
    grupos.set(k, [...(grupos.get(k) ?? []), it]);
  }

  async function actualizar(soloIds?: string[], forzar = false) {
    setCorriendo(true);
    const aLeer = items.filter((i) => !i.bloqueado && (!soloIds || soloIds.includes(i.id)));
    const leidos = new Set<number>();
    const comprasPorLocal = new Map<number, { created: number; updated: number; comprasDistribuidasModificadas?: string[] }[]>();
    for (const it of aLeer) {
      setEstados((s) => ({ ...s, [it.id]: { corriendo: true } }));
      let resultado: ResultadoItem;
      try {
        const res = await fetch("/api/etl/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: it.id, forzar }),
        });
        resultado = await res.json().catch(() => ({ id: it.id, error: `Error ${res.status}` }));
      } catch {
        resultado = { id: it.id, error: "Error de red" };
      }
      if ("report" in resultado) leidos.add(it.localId);
      if ("report" in resultado && resultado.report.fileType === "compras") {
        const { created, updated, comprasDistribuidasModificadas } = resultado.report;
        comprasPorLocal.set(it.localId, [...(comprasPorLocal.get(it.localId) ?? []), { created, updated, comprasDistribuidasModificadas }]);
      }
      setEstados((s) => ({ ...s, [it.id]: { resultado } }));
    }
    for (const localId of leidos) {
      await fetch("/api/etl/render/finalizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ local_id: localId, compras: comprasPorLocal.get(localId) ?? [] }),
      }).catch(() => {});
    }
    setCorriendo(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["render-items"] }),
      queryClient.invalidateQueries({ queryKey: ["pivot"] }),
      queryClient.invalidateQueries({ queryKey: ["detalle"] }),
      queryClient.invalidateQueries({ queryKey: ["actualizado-al"] }),
    ]);
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
        <div className="flex items-center gap-2 min-w-0">
          <Database className="h-4 w-4 text-sky-600 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Desde Render · automático</div>
            <div className="text-xs text-muted-foreground">
              El kit sube los informes cada mañana y el Panel los lee solo a las 9:40. Lo que no cambió se saltea.
            </div>
          </div>
        </div>
        {q.data?.configurado && items.length > 0 && (
          <button
            type="button"
            onClick={() => actualizar()}
            disabled={corriendo}
            className="inline-flex shrink-0 items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {corriendo ? <Spinner size="sm" className="text-primary-foreground" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Actualizar ahora
          </button>
        )}
      </div>

      {q.isLoading ? (
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
                      <Estado it={it} local={estados[it.id]} />
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
