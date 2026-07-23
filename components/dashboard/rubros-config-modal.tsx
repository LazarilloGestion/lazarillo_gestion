"use client";

import { useEffect, useState, useCallback } from "react";
import { notify } from "@/lib/toast";
import { useDashboard } from "@/hooks/use-dashboard-store";
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

interface RubroConfig {
  codigo: string;
  nombre: string;
  visible: boolean;
}

interface RubrosConfigModalProps {
  field?: VisibilidadField;
  title?: string;
}

export function RubrosConfigModal({ field = "visibleEnDashboard", title = "Rubros visibles en panel" }: RubrosConfigModalProps) {
  const {
    bumpRubroConfig, rubroOcultoCount, setRubroOcultoCount,
    bumpResultadosConfig, resultadosOcultoCount, setResultadosOcultoCount,
  } = useDashboard();
  const isResultados = field === "visibleEnResultados";
  const ocultoCount = isResultados ? resultadosOcultoCount : rubroOcultoCount;
  const setOcultoCount = isResultados ? setResultadosOcultoCount : setRubroOcultoCount;
  const bumpConfig = isResultados ? bumpResultadosConfig : bumpRubroConfig;

  const [open, setOpen] = useState(false);
  const [rubros, setRubros] = useState<RubroConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchRubros = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/config/rubros-dashboard?field=${field}`)
      .then(async (r) => {
        const text = await r.text();
        if (!text) throw new Error(`Respuesta vacía (HTTP ${r.status})`);
        const data = JSON.parse(text);
        if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
        const list: RubroConfig[] = Array.isArray(data) ? data : [];
        setRubros(list);
        setOcultoCount(list.filter((r) => !r.visible).length);
      })
      .catch((e) => { console.error(e); setError(e.message); })
      .finally(() => setLoading(false));
  }, [field, setOcultoCount]);

  // Mount: fetcha para poblar el badge count sin abrir el modal.
  useEffect(() => { fetchRubros(); }, [fetchRubros]);

  // Open: fetcha para lista fresca cada vez que se abre.
  useEffect(() => { if (open) fetchRubros(); }, [open, fetchRubros]);

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
      setRubros(next);
      setOcultoCount(next.filter((r) => !r.visible).length);
      bumpConfig();
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
            ocultoCount > 0
              ? "border-zinc-400 dark:border-zinc-500 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600"
          )}
        >
          <Settings2 className="w-3.5 h-3.5" />
          {ocultoCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 dark:bg-zinc-100 text-[9px] font-bold leading-none text-white dark:text-zinc-900">
              {ocultoCount}
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
              Error: {error}
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
