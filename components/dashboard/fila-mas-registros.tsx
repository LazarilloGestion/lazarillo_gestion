"use client";
import type { FilaMas } from "@/lib/dashboard/pivot-utils";
import { TANDA_PIVOT } from "@/lib/dashboard/pivot-utils";

const fmt = (n: number) => n.toLocaleString("es-AR");

// Fila al pie de un concepto abierto con muchos registros (ver TANDA_PIVOT).
export function FilaMasRegistros({ fila, onVerMas }: { fila: FilaMas; onVerMas: (conceptoId: string, todos: boolean) => void }) {
  const quedan = fila.total - fila.mostrados;
  const btn = "underline underline-offset-2 hover:text-foreground";
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span>Se muestran {fmt(fila.mostrados)} de {fmt(fila.total)}</span>
      <span aria-hidden>·</span>
      {quedan > TANDA_PIVOT && (
        <>
          <button type="button" className={btn} onClick={() => onVerMas(fila.conceptoId, false)}>Ver {TANDA_PIVOT} más</button>
          <span aria-hidden>·</span>
        </>
      )}
      <button type="button" className={btn} onClick={() => onVerMas(fila.conceptoId, true)}>{quedan > TANDA_PIVOT ? "Ver todos" : `Ver ${fmt(quedan)} más`}</button>
    </span>
  );
}
