"use client";

import { useMemo, useState } from "react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { fmtMillones, separar, sumaSaldos, type ImpagasResponse } from "@/lib/impagas/clasificar";
import type { Local } from "@/lib/types/domain";
import { ImpagasModal, impagasQueryKey, type OpcionPdv } from "./impagas-modal";

// Botón del panel "● Impagas: N · $X M" — cuenta las del PDV elegido en el panel
// y abre el listado filtrado en ese PDV (se puede cambiar adentro).
export function ImpagasBoton({ locales, pdvId }: { locales: Local[]; pdvId: number | undefined }) {
  const [open, setOpen] = useState(false);
  const pdvs: OpcionPdv[] = useMemo(
    () => locales.flatMap((l) => l.puntosDeVenta.map((p) => ({ id: p.id, label: `${l.nombre} · ${p.nombre}` }))),
    [locales]
  );
  const { data } = useFetchQuery<ImpagasResponse>(
    impagasQueryKey(pdvId), pdvId ? `/api/impagas?pdvId=${pdvId}` : null, { staleTime: 60_000 }
  );
  const impagas = useMemo(() => (data ? separar(data.data).impagas : null), [data]);

  if (pdvs.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "h-8 px-3 flex items-center gap-2 rounded-lg border text-sm transition-all shrink-0",
          impagas?.length
            ? "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:border-red-300"
            : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300"
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", impagas?.length ? "bg-red-500" : "bg-zinc-300")} />
        {impagas ? `Impagas: ${impagas.length} · ${fmtMillones(sumaSaldos(impagas))}` : "Impagas"}
      </button>
      <ImpagasModal open={open} onClose={() => setOpen(false)} pdvs={pdvs} pdvInicial={pdvId} />
    </>
  );
}
