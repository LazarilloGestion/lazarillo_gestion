import { cn, fmtARS } from "@/lib/utils";
import { pctSobreIngresos, heatmapText } from "@/lib/dashboard/resultados-calc";
import { cardCellClasses } from "@/lib/dashboard/card-row-classes";
import { SectionDivider } from "./section-divider";
import { StickyCardCell } from "./sticky-card-cell";
import { Users } from "lucide-react";

const VALUE_TD = "text-right px-3 py-1.5 tabular-nums whitespace-nowrap";
const TOTAL_TD = "text-right px-4 py-1.5 font-semibold tabular-nums whitespace-nowrap";

interface SocietarioRowsProps {
  months: number[];
  ingresosPorMes: Record<number, number>;
  ingresosTotal?: number;
  gananciaPorMes: Record<number, number>;
  gananciaTotal: number;
  isEmpty: boolean;
}

export function SocietarioRows({
  months, ingresosPorMes, ingresosTotal, gananciaPorMes, gananciaTotal, isEmpty,
}: SocietarioRowsProps) {
  const colSpan = months.length + 3; // label + meses + total + % ing

  // Escala relativa por fila sobre el % de rentabilidad de cada mes visible (no sobre la
  // ganancia cruda) — mismo criterio que pide el doc para el heatmap de Ingresos.
  const pctPorMes = months.map((mes) => {
    const raw = gananciaPorMes[mes];
    if (isEmpty || raw == null) return null;
    const ing = ingresosPorMes[mes] ?? 0;
    return ing > 0 ? (raw / ing) * 100 : null;
  });
  const pctValidos = pctPorMes.filter((v): v is number => v != null);
  const minPct = pctValidos.length ? Math.min(...pctValidos) : 0;
  const maxPct = pctValidos.length ? Math.max(...pctValidos) : 0;

  return (
    <>
      <SectionDivider label="Societario" icon={Users} colSpan={colSpan} topOfCard />

      <tr>
        <StickyCardCell position="middle" bg="bg-success-muted" className="px-4 py-1.5 whitespace-nowrap text-[15px] font-semibold">
          Ganancia
        </StickyCardCell>
        {months.map((mes) => {
          const raw = gananciaPorMes[mes];
          const gray = isEmpty || raw == null;
          return (
            <td
              key={mes}
              className={cn(
                VALUE_TD,
                cardCellClasses("middle", "mid"),
                "bg-success-muted text-[15px] font-semibold",
                gray ? "text-muted-foreground/40" : (raw ?? 0) < 0 && "text-destructive"
              )}
            >
              {gray ? "—" : fmtARS(raw)}
            </td>
          );
        })}
        <td
          className={cn(
            TOTAL_TD,
            cardCellClasses("middle", "mid"),
            "bg-success-muted text-[15px] font-semibold",
            isEmpty ? "text-muted-foreground/40" : gananciaTotal < 0 && "text-destructive"
          )}
        >
          {isEmpty ? "—" : fmtARS(gananciaTotal)}
        </td>
        <td className={cn("bg-success-muted", cardCellClasses("middle", "right"))} />
      </tr>

      <tr>
        <StickyCardCell position="last" className="px-4 py-1.5 whitespace-nowrap">% Rentabilidad</StickyCardCell>
        {months.map((mes, i) => {
          const raw = gananciaPorMes[mes];
          const pct = pctPorMes[i];
          const label = isEmpty || raw == null ? "—" : pctSobreIngresos(raw, ingresosPorMes[mes] ?? 0);
          const color = pct != null ? heatmapText(pct, minPct, maxPct) : undefined;
          return (
            <td key={mes} className={cn(VALUE_TD, cardCellClasses("last", "mid"))}>
              <span style={color ? { color } : undefined} className={cn(!color && "text-muted-foreground/40")}>{label}</span>
            </td>
          );
        })}
        <td className={cn(TOTAL_TD, cardCellClasses("last", "mid"))}>
          {(() => {
            const label = isEmpty ? "—" : pctSobreIngresos(gananciaTotal, ingresosTotal ?? 0);
            const isDash = label === "—";
            return <span className={cn(isDash ? "text-muted-foreground/40" : "text-[#159457]")}>{label}</span>;
          })()}
        </td>
        <td className={cardCellClasses("last", "right")} />
      </tr>
    </>
  );
}
