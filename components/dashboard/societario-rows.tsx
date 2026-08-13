import { cn, fmtARS } from "@/lib/utils";
import { pctSobreIngresos, heatmapTextZeroAnchored, heatmapFillZeroAnchored, RESULT_COLORS } from "@/lib/dashboard/resultados-calc";
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

  // Min/max del % de rentabilidad de cada mes visible, para heatmapTextZeroAnchored — misma
  // escala anclada en 0 que la fila de Ganancia (heatmapFillZeroAnchored), para que ambas filas
  // coincidan en qué meses pintan rojo.
  const pctPorMes = months.map((mes) => {
    const raw = gananciaPorMes[mes];
    if (isEmpty || raw == null) return null;
    const ing = ingresosPorMes[mes] ?? 0;
    return ing > 0 ? (raw / ing) * 100 : null;
  });
  const pctValidos = pctPorMes.filter((v): v is number => v != null);
  const minPct = pctValidos.length ? Math.min(...pctValidos) : 0;
  const maxPct = pctValidos.length ? Math.max(...pctValidos) : 0;

  // Min/max de la ganancia cruda de cada mes visible, para heatmapFillZeroAnchored
  // (escala anclada en 0, no en el mínimo de la fila — ver comentario del helper).
  const gananciaVisible = months.map((m) => gananciaPorMes[m]).filter((v): v is number => v != null);
  const minGanancia = gananciaVisible.length ? Math.min(...gananciaVisible) : 0;
  const maxGanancia = gananciaVisible.length ? Math.max(...gananciaVisible) : 0;

  return (
    <>
      <SectionDivider label="Societario" icon={Users} colSpan={colSpan} topOfCard />

      <tr>
        <StickyCardCell position="middle" className="px-4 py-1.5 whitespace-nowrap text-[15px] font-semibold">
          Ganancia
        </StickyCardCell>
        {months.map((mes) => {
          const raw = gananciaPorMes[mes];
          const gray = isEmpty || raw == null;
          const fill = !gray ? heatmapFillZeroAnchored(raw, minGanancia, maxGanancia) : null;
          return (
            <td
              key={mes}
              className={cn(
                VALUE_TD,
                cardCellClasses("middle", "mid"),
                "text-[15px] font-semibold",
                gray && "text-muted-foreground/40"
              )}
              style={fill ? { backgroundColor: fill.background, color: fill.foreground } : undefined}
            >
              {gray ? "—" : fmtARS(raw)}
            </td>
          );
        })}
        <td
          className={cn(
            TOTAL_TD,
            cardCellClasses("middle", "mid"),
            "text-[15px] font-semibold",
            isEmpty ? "text-muted-foreground/40" : gananciaTotal < 0 && "text-destructive"
          )}
        >
          {isEmpty ? "—" : fmtARS(gananciaTotal)}
        </td>
        <td className={cardCellClasses("middle", "right")} />
      </tr>

      <tr>
        <StickyCardCell position="last" className="px-4 py-1.5 whitespace-nowrap">% Rentabilidad</StickyCardCell>
        {months.map((mes, i) => {
          const raw = gananciaPorMes[mes];
          const pct = pctPorMes[i];
          const label = isEmpty || raw == null ? "—" : pctSobreIngresos(raw, ingresosPorMes[mes] ?? 0);
          const color = pct != null ? heatmapTextZeroAnchored(pct, minPct, maxPct) : undefined;
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
            return <span className={cn(isDash && "text-muted-foreground/40")} style={isDash ? undefined : { color: RESULT_COLORS.positive }}>{label}</span>;
          })()}
        </td>
        <td className={cardCellClasses("last", "right")} />
      </tr>
    </>
  );
}
