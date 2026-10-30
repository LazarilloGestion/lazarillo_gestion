"use client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";
import type { CambioVariable, GastoConcepto, VariableEq } from "@/lib/dashboard/equilibrio-config";

// Configuración de gastos variables del equilibrio (tabla equilibrio_variables). Con ref = mes de
// referencia trae además los gastos por concepto del PDV elegido (para el antes → después del ⚙).
export function useEquilibrioVariables(ref?: { anio: number; mes: number } | null, enabled = true) {
  const { localId, pdvId } = useDashboard();
  const sp = new URLSearchParams();
  if (ref) { sp.set("anio", String(ref.anio)); sp.set("mes", String(ref.mes)); }
  if (ref && localId != null) sp.set("localId", String(localId));
  if (ref && pdvId != null) sp.set("pdvId", String(pdvId));
  const { data, isLoading } = useFetchQuery<{ variables: VariableEq[]; gastos?: GastoConcepto[] }>(
    ["equilibrio-variables", ref?.anio ?? null, ref?.mes ?? null, ref ? localId ?? null : null, ref ? pdvId ?? null : null],
    enabled ? `/api/dashboard/equilibrio/variables?${sp.toString()}` : null,
    { staleTime: 60_000 });
  const queryClient = useQueryClient();

  async function guardar(cambios: CambioVariable[]): Promise<boolean> {
    if (!cambios.length) return true;
    const res = await fetch("/api/dashboard/equilibrio/variables", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cambios }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (!res?.ok) { toast.error(d?.error ?? "No se pudo guardar"); return false; }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["equilibrio-variables"] }),
      queryClient.invalidateQueries({ queryKey: ["equilibrio"] }),
    ]);
    return true;
  }

  return { variables: data?.variables ?? null, gastos: data?.gastos ?? null, isLoading, guardar };
}
