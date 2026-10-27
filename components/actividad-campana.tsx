"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { agruparPorDia, horaDe, partesDescripcion, TITULO_ACCION } from "@/lib/actividad/formato";
import { VerFactura } from "@/components/facturas/ver-factura";
import { refrescarCompras } from "@/components/facturas/cargar-factura";

type Item = { id: number; tipo: string; accion: string; descripcion: string; refId: string | null; usuario: string | null; creadoEn: string; restaurable: boolean };
type Resp = { yo: string; hayMas: boolean; data: Item[] };

const CLAVE_VISTO = "actividad:visto";
const leerVisto = () => { try { return localStorage.getItem(CLAVE_VISTO) ?? ""; } catch { return ""; } };

const ICONO: Record<string, { Icono: typeof Plus; cls: string }> = {
  creada: { Icono: Plus, cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  editada: { Icono: Pencil, cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  eliminada: { Icono: Trash2, cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  restaurada: { Icono: RotateCcw, cls: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" },
};

// Campanita de Actividad, a la derecha de la luna (Diego, 27/10/2026 — opción A):
// lo último que se hizo, por día, para volver rápido y modificarlo.
export function ActividadCampana() {
  const [abierta, setAbierta] = useState(false);
  const [todos, setTodos] = useState(false);
  const [limite, setLimite] = useState(20);
  const [visto, setVisto] = useState(leerVisto);
  const [vistoAlAbrir, setVistoAlAbrir] = useState(visto);
  const [ver, setVer] = useState<{ rowId: string; detalle: string } | null>(null);
  const [restaurando, setRestaurando] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading } = useFetchQuery<Resp>(["actividad", todos, limite], `/api/actividad?limite=${limite}${todos ? "&todos=1" : ""}`, { staleTime: 30_000 });
  // El número cuenta lo mío nuevo desde la última vez que se abrió.
  const { data: mia } = useFetchQuery<Resp>(["actividad", false, 20], "/api/actividad?limite=20", { staleTime: 30_000 });
  const nuevos = (mia?.data ?? []).filter((a) => a.creadoEn > visto).length;
  const grupos = useMemo(() => agruparPorDia(data?.data ?? []), [data]);

  function abrir(o: boolean) {
    setAbierta(o);
    if (o) {
      setVistoAlAbrir(visto);
      void queryClient.invalidateQueries({ queryKey: ["actividad"] });
    } else {
      const ahora = new Date().toISOString();
      try { localStorage.setItem(CLAVE_VISTO, ahora); } catch { /* sin storage */ }
      setVisto(ahora);
    }
  }

  async function restaurar(a: Item) {
    setRestaurando(a.id);
    const r = await fetch(`/api/actividad/${a.id}/restaurar`, { method: "POST" }).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    setRestaurando(null);
    if (!r?.ok) { toast.error(d?.error ?? "No se pudo restaurar"); return; }
    toast.success("Factura restaurada");
    refrescarCompras(queryClient);
  }

  return (
    <>
      <Popover open={abierta} onOpenChange={abrir}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn("relative h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors", abierta && "bg-muted")}
            aria-label="Actividad"
            title="Actividad"
          >
            <Bell className="w-4 h-4" />
            {nuevos > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[#5BC2EA] text-white text-[9.5px] font-bold leading-4 text-center ring-2 ring-background">
                {nuevos > 9 ? "9+" : nuevos}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[390px] max-w-[94vw] rounded-xl shadow-xl">
          <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
            <b className="text-sm">Actividad</b>
            <div className="flex overflow-hidden rounded-lg border text-[11.5px]">
              {[["Mía", false], ["Todos", true]].map(([t, v]) => (
                <button key={String(t)} type="button" onClick={() => { setTodos(v as boolean); setLimite(20); }}
                  className={cn("px-2.5 py-0.5", todos === v ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-muted-foreground")}>{t as string}</button>
              ))}
            </div>
          </div>
          <div className="max-h-[min(560px,70vh)] overflow-y-auto pb-1">
            {isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
            {!isLoading && grupos.length === 0 && (
              <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">Todavía no hay actividad. Acá van a aparecer las facturas que cargues, edites o elimines.</p>
            )}
            {grupos.map((g) => (
              <div key={g.dia}>
                <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{g.dia}</div>
                {g.items.map((a) => {
                  const { nombre, detalle } = partesDescripcion(a.descripcion);
                  const ic = ICONO[a.accion] ?? ICONO.creada;
                  const abrible = a.tipo === "factura" && a.accion !== "eliminada" && !!a.refId;
                  const nuevo = a.creadoEn > vistoAlAbrir && (!todos || a.usuario === data?.yo);
                  return (
                    <div key={a.id}
                      onClick={() => { if (abrible) { setVer({ rowId: a.refId!, detalle: detalle.split(" · ")[0] }); abrir(false); } }}
                      className={cn("flex items-start gap-2.5 px-3.5 py-2", abrible && "cursor-pointer hover:bg-sky-50/60 dark:hover:bg-sky-950/20")}>
                      <span className={cn("mt-2.5 size-1.5 shrink-0 rounded-full", nuevo ? "bg-[#5BC2EA]" : "bg-transparent")} />
                      <span className={cn("mt-0.5 flex size-[26px] shrink-0 items-center justify-center rounded-md", ic.cls)}><ic.Icono className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-snug">
                          {TITULO_ACCION[a.tipo]?.[a.accion] ?? `${a.tipo} ${a.accion}`}
                          {nombre && <> · <b className="font-semibold">{nombre}</b></>}
                        </span>
                        <span className="block truncate text-[11.5px] text-muted-foreground" title={detalle}>{detalle}</span>
                        {todos && a.usuario && a.usuario !== data?.yo && <span className="block text-[10.5px] text-muted-foreground/80">{a.usuario}</span>}
                        {abrible && <span className="mt-0.5 block text-[11px] font-semibold text-[#0d6fa8]">Ver / editar ›</span>}
                        {a.restaurable && (
                          <button type="button" disabled={restaurando === a.id} onClick={(e) => { e.stopPropagation(); void restaurar(a); }}
                            className="mt-0.5 text-[11px] font-semibold text-[#0d6fa8] hover:underline disabled:opacity-50">
                            {restaurando === a.id ? "Restaurando…" : "Restaurar ›"}
                          </button>
                        )}
                      </span>
                      <span className="mt-0.5 shrink-0 text-[11px] text-muted-foreground tabular-nums">{horaDe(new Date(a.creadoEn))}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {data?.hayMas && (
            <button type="button" onClick={() => setLimite((n) => n + 40)} className="border-t py-2 text-center text-xs text-[#0d6fa8] hover:bg-muted/50">
              Ver más actividad
            </button>
          )}
        </PopoverContent>
      </Popover>
      {ver && <VerFactura rowId={ver.rowId} detalle={ver.detalle} onClose={() => setVer(null)} />}
    </>
  );
}
