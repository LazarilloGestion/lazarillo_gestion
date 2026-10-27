"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Wallet, Check, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMediosPago, MEDIOS_PAGO_KEY } from "@/hooks/use-medios-pago";
import { TIPOS_MEDIO, etiquetaTipoMedio, type MedioPago, type TipoMedio } from "@/lib/medios-pago/abm";

// Gestor de medios de pago (Diego, 27/10/2026): la lista que ofrecen todos los
// pagos del Panel (Impagas, cuenta corriente, carga de factura, Gastos Varios).

type Form = { id: number | null; nombre: string; tipo: TipoMedio; pideId: boolean };

function Fila({ inicial, onCerrar, onGuardado }: { inicial: Form; onCerrar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    if (!f.nombre.trim()) { setError("Poné un nombre"); return; }
    setGuardando(true);
    try {
      const res = await fetch(f.id ? `/api/medios-pago/${f.id}` : "/api/medios-pago", {
        method: f.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: f.nombre, tipo: f.tipo, pideId: f.pideId }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) { setError(b?.error ?? "No se pudo guardar"); return; }
      toast.success(f.id ? "Medio actualizado" : "Medio agregado");
      onGuardado();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <tr className="border-b bg-sky-50/60 dark:bg-sky-950/20">
      <td className="px-4 py-2">
        <Input
          autoFocus value={f.nombre} maxLength={40} placeholder="ej. Mercado Pago"
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") void guardar(); if (e.key === "Escape") onCerrar(); }}
          className="h-8 w-56"
        />
        {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
      </td>
      <td className="px-4 py-2">
        <select
          value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoMedio })}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          {TIPOS_MEDIO.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
        </select>
      </td>
      <td className="px-4 py-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.pideId} onChange={(e) => setF({ ...f, pideId: e.target.checked })} className="size-4" />
          Pide ID
        </label>
      </td>
      <td />
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <button type="button" disabled={guardando} onClick={() => void guardar()} className="mr-1 inline-flex h-8 items-center gap-1 rounded-md bg-zinc-900 px-3 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900">
          <Check className="size-3.5" /> Guardar
        </button>
        <button type="button" onClick={onCerrar} className="inline-flex h-8 items-center rounded-md border px-2 text-sm" title="Cancelar">
          <X className="size-3.5" />
        </button>
      </td>
    </tr>
  );
}

export default function MediosPagoPage() {
  const { data, isLoading, error } = useMediosPago();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const refrescar = () => void queryClient.invalidateQueries({ queryKey: MEDIOS_PAGO_KEY });

  async function cambiarActivo(m: MedioPago) {
    const res = await fetch(`/api/medios-pago/${m.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: m.nombre, tipo: m.tipo, pideId: m.pideId, activo: !m.activo }),
    });
    if (!res.ok) { toast.error("No se pudo cambiar"); return; }
    toast.success(m.activo ? `${m.nombre} desactivado: ya no se ofrece al pagar` : `${m.nombre} activado`);
    refrescar();
  }

  async function borrar(m: MedioPago) {
    const res = await fetch(`/api/medios-pago/${m.id}`, { method: "DELETE" });
    const b = await res.json().catch(() => null);
    if (!res.ok) { toast.error(b?.error ?? "No se pudo borrar"); return; }
    toast.success(`${m.nombre} borrado`);
    refrescar();
  }

  const lista = data ?? [];
  const th = "px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";

  return (
    <div className="p-4 md:p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Medios de pago</h1>
        <p className="text-sm text-muted-foreground">
          La lista que ofrecen todos los pagos del Panel. Un medio con pagos no se borra: se desactiva y deja de ofrecerse.
        </p>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center"><Spinner size="lg" /></div>
      ) : error ? (
        <p className="text-sm text-destructive">No se pudieron leer los medios de pago.</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden max-w-4xl">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
            <div className="flex items-center gap-2 text-sm font-medium"><Wallet className="h-4 w-4 text-muted-foreground" /> {lista.length} medio{lista.length === 1 ? "" : "s"}</div>
            <button
              type="button" disabled={form?.id === null}
              onClick={() => setForm({ id: null, nombre: "", tipo: "banco", pideId: false })}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-zinc-900 px-3 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
            >
              <Plus className="size-3.5" /> Nuevo medio
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className={th}>Nombre</th><th className={th}>Tipo</th><th className={th}>ID</th>
                <th className={cn(th, "text-right")}>Pagos</th><th className={th} />
              </tr>
            </thead>
            <tbody>
              {form?.id === null && <Fila inicial={form} onCerrar={() => setForm(null)} onGuardado={() => { setForm(null); refrescar(); }} />}
              {lista.map((m) => form?.id === m.id ? (
                <Fila key={m.id} inicial={form} onCerrar={() => setForm(null)} onGuardado={() => { setForm(null); refrescar(); }} />
              ) : (
                <tr key={m.id} className={cn("border-b last:border-0", !m.activo && "text-muted-foreground")}>
                  <td className="px-4 py-2.5 font-medium">
                    {m.nombre}
                    {!m.activo && <span className="ml-2 rounded border px-1 text-[10px] font-normal">desactivado</span>}
                  </td>
                  <td className="px-4 py-2.5">{etiquetaTipoMedio(m.tipo)}</td>
                  <td className="px-4 py-2.5">{m.pideId ? "Pide ID" : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.usos || "—"}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button type="button" onClick={() => void cambiarActivo(m)} className="mr-3 text-xs text-muted-foreground underline-offset-2 hover:underline">
                      {m.activo ? "Desactivar" : "Activar"}
                    </button>
                    <button type="button" onClick={() => setForm({ id: m.id, nombre: m.nombre, tipo: m.tipo, pideId: m.pideId })} className="mr-2 text-muted-foreground hover:text-foreground" title="Editar">
                      <Pencil className="inline size-3.5" />
                    </button>
                    {m.usos === 0 ? (
                      <button type="button" onClick={() => void borrar(m)} className="text-muted-foreground hover:text-destructive" title="Borrar">
                        <Trash2 className="inline size-3.5" />
                      </button>
                    ) : <span className="inline-block w-3.5" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
