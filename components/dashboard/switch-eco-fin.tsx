"use client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";

type Modo = "economica" | "financiera";

// Textos de Diego (doc Etapa 3, punto 4, 14/10/2026).
const MODOS: { modo: Modo; label: string; leyenda: string; tooltip: string }[] = [
  {
    modo: "economica",
    label: "Económica",
    leyenda: "Mide si el negocio genera ganancia. Compará ventas contra costos y gastos del período, sin importar cuándo se cobra o se paga. Tu objetivo: aumentar ventas o reducir costos.",
    tooltip: "Acá se cuenta lo vendido y lo gastado en el mes, aunque la plata todavía no haya entrado ni salido. Si este tablero da ganancia pero la caja está floja, el problema no es el negocio: son los plazos de cobro y pago.",
  },
  {
    modo: "financiera",
    label: "Financiera",
    leyenda: "Muestra la salud de tu caja: cuánta plata entró y salió en el período, y con cuánto quedás para afrontar los próximos pagos. Tu objetivo: no gastar más de lo que te ingresa.",
    tooltip: "Acá se cuenta solo la plata que efectivamente entró y salió. Si da bien pero el económico da pérdida, cuidado: la caja puede estar sostenida por señas, aportes tuyos o plata de otra unidad del negocio, no por lo que esta genera.",
  },
];

// Por ahora la Financiera cambia solo los egresos (fecha de pago); los ingresos
// siguen por fecha de venta hasta tener el detalle de cobros (Diego, 26/10/2026).
const NOTA_FINANCIERA = "Egresos por fecha de pago (facturas según el informe 80; gastos varios y sueldos según su caja). Ingresos por fecha de venta.";

export function SwitchEcoFin() {
  const modo = useDashboardStore((s) => s.modoPanel);
  const setModo = useDashboardStore((s) => s.setModoPanel);
  const actual = MODOS.find((m) => m.modo === modo) ?? MODOS[0];

  return (
    // La leyenda pasó a un ⓘ para despejar el encabezado (rediseño, Diego 30/10/2026).
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1.5">
        <div role="radiogroup" aria-label="Vista del panel" className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5">
          {MODOS.map((m) => (
            <Tooltip key={m.modo}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={modo === m.modo}
                  onClick={() => setModo(m.modo)}
                  className={cn(
                    "h-7 px-3 rounded-md text-xs font-medium transition-all",
                    modo === m.modo
                      ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m.label}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[320px] text-xs leading-snug">
                {m.tooltip}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`Qué muestra la vista ${actual.label}`} className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
              <Info className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[340px] text-xs leading-snug">
            {actual.leyenda}
            {modo === "financiera" && <span className="block mt-1 opacity-80">{NOTA_FINANCIERA}</span>}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
