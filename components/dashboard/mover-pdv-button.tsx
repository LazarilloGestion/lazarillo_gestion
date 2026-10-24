"use client";
import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn, fmtARS } from "@/lib/utils";
import { destinosMover, type DestinoMover } from "@/lib/apertura/mover";
import type { Local } from "@/lib/types/domain";

type FilaMovible = { rowId: string; localIdOrigen: number | null; puntoDeVentaIdOrigen: number | null };

// Ícono ⇄ de la fila (Diego eligió la opción A, 24/10/2026): elegís el PDV y
// el gasto pasa entero ahí. Con filas tildadas actúa sobre todas las tildadas.
export function MoverPdvButton<T extends FilaMovible>({
  filas,
  importeTotal,
  locales,
  portalContainer,
  onMover,
}: {
  // Filas sobre las que actúa (la de este ícono, o todas las tildadas).
  filas: T[];
  importeTotal: number;
  locales: Local[];
  portalContainer: HTMLElement | null;
  onMover: (filas: T[], destino: DestinoMover) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [moviendo, setMoviendo] = useState<number | null>(null);
  const destinos = destinosMover(locales, filas);
  const n = filas.length;

  return (
    <Popover open={abierto} onOpenChange={(o) => { if (moviendo == null) setAbierto(o); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={n > 1 ? `Mover los ${n} tildados a otro PDV` : "Mover a otro PDV"}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "h-4 w-4 shrink-0 flex items-center justify-center rounded hover:bg-muted transition-opacity",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            abierto ? "text-foreground opacity-100" : "text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          )}
        >
          <ArrowLeftRight className="w-2.5 h-2.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent container={portalContainer} align="end" className="w-60 p-1.5 text-xs">
        <div className="px-2 pb-1.5 pt-1 text-[11px] text-muted-foreground">
          Mover {n > 1 ? `${n} registros` : "el registro"} ({fmtARS(importeTotal)}) a…
        </div>
        {destinos.map((d) => (
          <button
            key={d.puntoDeVentaId}
            type="button"
            disabled={d.deshabilitado || moviendo != null}
            onClick={async () => {
              setMoviendo(d.puntoDeVentaId);
              try {
                await onMover(filas, d);
                setAbierto(false);
              } finally {
                setMoviendo(null);
              }
            }}
            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-muted disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
          >
            <span className="truncate">
              {d.etiqueta}
              {d.deshabilitado && <span className="ml-1 text-[10px]">(están acá)</span>}
            </span>
            {moviendo === d.puntoDeVentaId && <Spinner size="sm" />}
          </button>
        ))}
        <p className="px-2 pt-1.5 pb-0.5 text-[10px] text-muted-foreground border-t mt-1">
          Se deshace desde ⅄ (es una apertura al 100%).
        </p>
      </PopoverContent>
    </Popover>
  );
}
