"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ETLFilaCruda, ETLSkippedRow, ETLRowError } from "@/lib/etl/types";

// Fila completa de un omitido o error de importación (punto 7 de
// Pendientes_desarrollo_etapa3): número de fila + todas las columnas tal como
// vinieron en el archivo. Para una "repetida", al lado la fila original que sí
// se cargó, con las celdas que difieren resaltadas, para decidir si es un
// duplicado real o dos gastos distintos que coinciden en la clave.

function columnasOrdenadas(...filas: (Record<string, string> | undefined)[]): string[] {
  const vistas = new Set<string>();
  for (const f of filas) for (const k of Object.keys(f ?? {})) vistas.add(k);
  return [...vistas];
}

function TablaFila({ fila, otra, titulo, resaltar }: {
  fila: ETLFilaCruda;
  otra?: ETLFilaCruda;
  titulo: string;
  resaltar?: "omitida" | "original";
}) {
  const cols = columnasOrdenadas(fila.columnas, otra?.columnas);
  return (
    <div className="min-w-0 flex-1">
      <div className={cn(
        "mb-1 text-[11px] font-medium uppercase tracking-wider",
        resaltar === "omitida" ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"
      )}>
        {titulo} · fila {fila.fila}
      </div>
      <table className="w-full text-[11px] font-mono">
        <tbody>
          {cols.map((k) => {
            const v = fila.columnas[k] ?? "";
            const difiere = otra != null && (otra.columnas[k] ?? "") !== v;
            return (
              <tr key={k} className={cn("border-t border-border/40", difiere && "bg-amber-50 dark:bg-amber-950/30")}>
                <td className="py-0.5 pr-2 text-zinc-400 whitespace-nowrap align-top w-28">{k}</td>
                <td className={cn("py-0.5 break-all text-zinc-700 dark:text-zinc-200", difiere && "font-semibold")}>{v || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function tieneFila(x: { fila?: number; columnas?: Record<string, string> }): x is { fila: number; columnas: Record<string, string> } {
  return typeof x.fila === "number" && x.columnas != null;
}

export function FilaOmitidaDetalle({ row }: { row: ETLSkippedRow }) {
  const [abierta, setAbierta] = useState(false);
  if (!tieneFila(row)) return null;
  const omitida: ETLFilaCruda = { fila: row.fila, columnas: row.columnas };
  const original = row.motivo === "duplicado" ? row.original : undefined;
  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 underline-offset-2 hover:underline"
      >
        {abierta ? "Ocultar fila" : original ? `Ver fila ${row.fila} y la original (fila ${original.fila})` : `Ver fila ${row.fila} completa`}
      </button>
      {abierta && (
        <div className="mt-1 flex gap-4 rounded-md border border-border/60 bg-muted/30 p-2">
          <TablaFila fila={omitida} otra={original} titulo={original ? "Omitida" : "Fila"} resaltar={original ? "omitida" : undefined} />
          {original && (
            <TablaFila fila={original} otra={omitida} titulo="Original (se cargó)" resaltar="original" />
          )}
        </div>
      )}
    </div>
  );
}

export function FilaErrorDetalle({ error }: { error: ETLRowError }) {
  const [abierta, setAbierta] = useState(false);
  if (!tieneFila(error)) return null;
  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 underline-offset-2 hover:underline"
      >
        {abierta ? "Ocultar fila" : `Ver fila ${error.fila} completa`}
      </button>
      {abierta && (
        <div className="mt-1 flex gap-4 rounded-md border border-border/60 bg-muted/30 p-2">
          <TablaFila fila={{ fila: error.fila, columnas: error.columnas }} titulo="Fila" />
        </div>
      )}
    </div>
  );
}
