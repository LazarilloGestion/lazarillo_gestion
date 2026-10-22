"use client";

import { useMemo, useState } from "react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { fmtMillones, separar, sumaSaldos, type ImpagasResponse } from "@/lib/impagas/clasificar";
import type { Local } from "@/lib/types/domain";
import { ImpagasModal, impagasQueryKey, leerDesde, resumenDeuda, type OpcionPdv } from "./impagas-modal";

// Botón del panel "● Impagas: N · $X M" — cuenta las del PDV elegido en el panel
// y abre el listado filtrado en ese PDV (se puede cambiar adentro).
export function ImpagasBoton({ locales, pdvId }: { locales: Local[]; pdvId: number | undefined }) {
  const [open, setOpen] = useState(false);
  const pdvs: OpcionPdv[] = useMemo(
    () => locales.flatMap((l) => l.puntosDeVenta.map((p) => ({ id: p.id, label: `${l.nombre} · ${p.nombre}` }))),
    [locales]
  );
  // Mismo "Desde" que quedó elegido en el modal (si no, el default del servidor).
  const [desde, setDesde] = useState<string | undefined>(() => leerDesde());
  const { data } = useFetchQuery<ImpagasResponse>(
    impagasQueryKey(pdvId, desde), pdvId ? `/api/impagas?pdvId=${pdvId}${desde ? `&desde=${desde}` : ""}` : null, { staleTime: 60_000 }
  );
  // Comprobantes impagos + lo que se le debe a otros PDV por aperturas.
  const resumen = useMemo(() => {
    if (!data) return null;
    const imp = separar(data.data).impagas;
    const deudas = (data.deudas ?? []).map((d) => resumenDeuda(d));
    return {
      n: imp.length + deudas.reduce((s, d) => s + d.pendientes, 0),
      saldo: sumaSaldos(imp) + deudas.reduce((s, d) => s + d.saldo, 0),
    };
  }, [data]);

  if (pdvs.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "h-8 px-3 flex items-center gap-2 rounded-lg border text-sm transition-all shrink-0",
          resumen?.n
            ? "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:border-red-300"
            : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300"
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", resumen?.n ? "bg-red-500" : "bg-zinc-300")} />
        {resumen ? `Impagas: ${resumen.n} · ${fmtMillones(resumen.saldo)}` : "Impagas"}
      </button>
      <ImpagasModal open={open} onClose={() => { setOpen(false); setDesde(leerDesde()); }} pdvs={pdvs} pdvInicial={pdvId} />
    </>
  );
}
