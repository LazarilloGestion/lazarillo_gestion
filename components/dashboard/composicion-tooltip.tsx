import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtARS } from "@/lib/utils";
import type { ComposicionMes } from "@/lib/dashboard/types";

// Envuelve una celda con el tooltip de prorrateo cuando hay composicion para
// esa celda (mes puntual o total anual, de concepto o de proveedor agregado)
// — sin composicion, devuelve la celda tal cual, sin tooltip. Antes de esta
// extracción vivía solo en pivot-table-por-proveedor.tsx; la vista concepto
// tenía una copia inline que NO redondeaba el %, a diferencia de esta — ver
// spec 2026-09-30 sobre por qué se unifica con Math.round.
export function ComposicionTooltip({
  comp,
  children,
}: {
  comp: ComposicionMes | undefined;
  children: React.ReactElement;
}) {
  if (!comp) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="text-xs">
        {/* TooltipContent es inline-flex (fila) por defecto — envolver en
            flex-col para que el detalle se lea de arriba a abajo en vez de
            romperse a mitad de palabra cuando hay 2+ destinos. */}
        <div className="flex flex-col items-start gap-0.5">
          <div className="font-medium">100% · {fmtARS(comp.total)}</div>
          {comp.destinos.map((d, i) => (
            <div key={i} className="text-background/70">
              {Math.round(d.pct)}% {d.nombre} {fmtARS(d.importe)}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
