"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { cn } from "@/lib/utils";
import { frescura, hoyArgentina, diasAtras, type Frescura } from "@/lib/dashboard/frescura";
import type { Local } from "@/lib/types/domain";

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

const PUNTO: Record<Frescura, string> = {
  al_dia: "bg-emerald-600",
  atrasado: "bg-amber-500",
  viejo: "bg-red-600",
};
const LEYENDA: Record<Frescura, string> = {
  al_dia: "al día",
  atrasado: "atrasado",
  viejo: "desactualizado",
};

// Chip "actualizado al" del PDV seleccionado (opción A, Diego 26/10/2026: solo
// el PDV elegido, no todos): ventas y compras con un punto de color según qué
// tan viejas son las ventas (verde hasta ayer, ámbar 2-3 días, rojo más).
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
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const base = data?.ventas ?? data?.compras;
  if (!base) return null;

  const hoy = hoyArgentina();
  const estado = frescura(base, hoy);
  const local = locales?.find((l) => l.id === localId);
  const pdv = local?.puntosDeVenta.find((p) => p.id === pdvId);
  const nombre = local ? (pdv ? `${local.nombre} · ${pdv.nombre}` : local.nombre) : "Todos los locales";
  const imp = data?.importado ? new Date(data.importado) : null;
  const titulo = [
    `${nombre}: ${LEYENDA[estado]} (ventas de hace ${diasAtras(base, hoy)} día${diasAtras(base, hoy) === 1 ? "" : "s"})`,
    imp ? `Última lectura: ${imp.toLocaleDateString("es-AR")} ${imp.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <span
      title={titulo}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 align-middle text-xs text-foreground cursor-help"
    >
      <span className={cn("size-2 shrink-0 rounded-full", PUNTO[estado])} />
      <span className="truncate">
        {pdv ? pdv.nombre : nombre}
        {data?.ventas && <> · ventas {ddmm(data.ventas)}</>}
        {data?.compras && <> · compras {ddmm(data.compras)}</>}
      </span>
    </span>
  );
}
