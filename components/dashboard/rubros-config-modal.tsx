"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notify } from "@/lib/toast";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { Settings2, Inbox } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { VisibilidadField } from "@/lib/dashboard/constants";
import type { RubroVisibilidad } from "@/lib/dashboard/types";

interface RubrosConfigModalProps {
  field?: VisibilidadField;
  title?: string;
}

export function RubrosConfigModal({ field = "visibleEnDashboard", title = "Rubros visibles en panel" }: RubrosConfigModalProps) {
  const {
    bumpRubroConfig, rubroVisibleCount, setRubroVisibleCount,
    bumpResultadosConfig, resultadosVisibleCount, setResultadosVisibleCount,
  } = useDashboard();
  const isResultados = field === "visibleEnResultados";
  const visibleCount = isResultados ? resultadosVisibleCount : rubroVisibleCount;
  const setVisibleCount = isResultados ? setResultadosVisibleCount : setRubroVisibleCount;
  const bumpConfig = isResultados ? bumpResultadosConfig : bumpRubroConfig;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Una sola query sirve para poblar el badge (sin abrir el modal) y la lista del modal;
  // TanStack Query cachea entre aperturas en vez de refetchear cada vez.
  const queryKey = ["rubros-dashboard", field];
  const { data, isLoading: loading, error } = useFetchQuery<RubroVisibilidad[]>(
    queryKey,
    `/api/config/rubros-dashboard?field=${field}`
  );
  const rubros = data ?? [];
  // Badge de alerta: solo aparece si hay al menos un rubro apagado (igual que antes),
  // pero ahora muestra cuántos SÍ están visibles en vez de cuántos están ocultos.
  const hayOcultos = rubros.length > 0 && visibleCount < rubros.length;

  // Mantiene el count del badge (store) sincronizado con lo que trae la query.
  useEffect(() => {
    if (data) setVisibleCount(data.filter((r) => r.visible).length);
  }, [data, setVisibleCount]);

  async function toggleRubro(codigo: string, visible: boolean) {
    const nombre = rubros.find((r) => r.codigo === codigo)?.nombre ?? codigo;
    setSaving(codigo);
    try {
      const res = await fetch("/api/config/rubros-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, visible, field }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = rubros.map((r) => (r.codigo === codigo ? { ...r, visible } : r));
      queryClient.setQueryData(queryKey, next);
      setVisibleCount(next.filter((r) => r.visible).length);
      bumpConfig();
      // La vista Impagas excluye por rubro oculto: que se recalcule.
      queryClient.invalidateQueries({ queryKey: ["impagas"] });
      notify.rubroVisibilidad(nombre, visible);
    } catch (e) {
      console.error(e);
      notify.errorActualizar(nombre);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          title="Configurar rubros visibles"
          className={cn(
            "relative h-8 w-8 flex items-center justify-center rounded-lg border transition-all shrink-0",
            hayOcultos
              ? "border-zinc-400 dark:border-zinc-500 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600"
          )}
        >
          <Settings2 className="w-3.5 h-3.5" />
          {hayOcultos && (
            <span
              title={`${visibleCount} visible${visibleCount === 1 ? "" : "s"} de ${rubros.length}`}
              className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 dark:bg-zinc-100 text-[9px] font-bold leading-none text-white dark:text-zinc-900"
            >
              {visibleCount}
            </span>
          )}
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings2 className="w-4 h-4" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1">
          Los rubros desactivados no aparecen en el panel ni se contabilizan en los totales.
        </p>

        <div className="mt-1 flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
          {loading ? (
            <div className="py-8 flex justify-center"><Spinner size="lg" /></div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-destructive">
              Error: {error.message}
            </div>
          ) : rubros.length === 0 ? (
            <div className="py-8 flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Inbox className="w-8 h-8 opacity-40" />
              No hay rubros cargados.
            </div>
          ) : (
            rubros.map((rubro) => (
              <div
                key={rubro.codigo}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition-colors",
                  rubro.visible
                    ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                    : "opacity-50"
                )}
              >
                <span className={cn(
                  "text-sm",
                  !rubro.visible && "text-muted-foreground"
                )}>
                  {rubro.nombre}
                </span>
                <Switch
                  checked={rubro.visible}
                  disabled={saving === rubro.codigo}
                  onCheckedChange={(v) => toggleRubro(rubro.codigo, v)}
                  aria-label={rubro.nombre}
                />
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
