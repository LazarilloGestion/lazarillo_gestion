"use client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";
import type { Componente } from "@/lib/dashboard/canasta";
import type { Grupo } from "@/lib/dashboard/aumentos";

export interface Aumento { fecha: string; origen: string; pct: number | null; provisorio: boolean; detalle?: Partial<Record<Grupo, number>> | null }
export interface CanastaData { meses: string[]; componentes: Componente[]; aumentos: Aumento[] }

// Canasta del PDV elegido hasta el mes de referencia (el último cerrado). Se recalcula poco: 1 h.
export function useCanasta(ref: { anio: number; mes: number } | null) {
  const { localId, pdvId } = useDashboard();
  const sp = new URLSearchParams();
  if (ref) { sp.set("anio", String(ref.anio)); sp.set("mes", String(ref.mes)); }
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("pdvId", String(pdvId));
  const { data, isLoading } = useFetchQuery<CanastaData>(
    ["canasta", ref?.anio ?? null, ref?.mes ?? null, localId ?? null, pdvId ?? null],
    ref ? `/api/dashboard/canasta?${sp.toString()}` : null, { staleTime: 60 * 60_000 });
  const queryClient = useQueryClient();

  async function aumento(metodo: "POST" | "DELETE", fecha: string) {
    if (pdvId == null) return;
    const res = await fetch("/api/dashboard/canasta/aumentos", {
      method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdvId, fecha }),
    }).catch(() => null);
    if (!res?.ok) { toast.error("No se pudo guardar el aumento"); return; }
    await queryClient.invalidateQueries({ queryKey: ["canasta"] });
  }

  async function detectar(): Promise<void> {
    if (pdvId == null) return;
    const res = await fetch("/api/dashboard/canasta/aumentos", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdvId, detectar: true }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (!res?.ok) { toast.error(d?.error ?? "No se pudo detectar"); return; }
    toast.success(d.nuevos?.length ? `Aumentos nuevos: ${d.nuevos.map((f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`).join(", ")}` : "No hay aumentos nuevos");
    await queryClient.invalidateQueries({ queryKey: ["canasta"] });
  }

  return { data: data ?? null, isLoading, detectar, agregarAumento: (f: string) => aumento("POST", f), quitarAumento: (f: string) => aumento("DELETE", f), conPdv: pdvId != null };
}
