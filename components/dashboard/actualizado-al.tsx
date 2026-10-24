"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";

const ddmmaaaa = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

// "Actualizado al 23/10/2026" bajo el título del panel: el último día con
// ventas del local/PDV elegido; en el tooltip, compras e importación.
export function ActualizadoAl() {
  const { localId, pdvId } = useDashboard();
  const sp = new URLSearchParams();
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("pdvId", String(pdvId));
  const { data } = useFetchQuery<{ ventas: string | null; compras: string | null; importado: string | null }>(
    ["actualizado-al", localId, pdvId],
    `/api/dashboard/actualizado?${sp.toString()}`,
    { staleTime: 5 * 60_000 }
  );
  const fecha = data?.ventas ?? data?.compras;
  if (!fecha) return null;
  const imp = data?.importado ? new Date(data.importado) : null;
  const detalle = [
    data?.ventas ? `Ventas al ${ddmmaaaa(data.ventas)}` : null,
    data?.compras ? `Compras al ${ddmmaaaa(data.compras)}` : null,
    imp ? `Última importación: ${imp.toLocaleDateString("es-AR")} ${imp.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <span title={detalle} className="cursor-help">
      Actualizado al <span className="font-medium text-foreground">{ddmmaaaa(fecha)}</span>
    </span>
  );
}
