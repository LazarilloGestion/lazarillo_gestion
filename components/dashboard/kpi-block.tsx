import { cn, fmtARS } from "@/lib/utils";
import { heatmapFill } from "@/lib/dashboard/resultados-calc";
import { cardCellClasses } from "@/lib/dashboard/card-row-classes";
import { StickyCardCell } from "./sticky-card-cell";

type KpiBlockProps = {
  months: number[];
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  ingresosTotal?: number;
  egresosTotal: number;
  ingresosReady: boolean;
  onIngresoCellClick?: (mes: number) => void;
  onIngresoTotalClick?: () => void;
};

export function KpiBlock({
  months,
  ingresosPorMes,
  egresosPorMes,
  ingresosTotal,
  egresosTotal,
  ingresosReady,
  onIngresoCellClick,
  onIngresoTotalClick,
}: KpiBlockProps) {
  const ingresosVisibles = months.map((m) => ingresosPorMes[m]).filter((v): v is number => v != null && v > 0);
  const minIngresos = ingresosVisibles.length ? Math.min(...ingresosVisibles) : 0;
  const maxIngresos = ingresosVisibles.length ? Math.max(...ingresosVisibles) : 1;

  return (
    <>
      <tr>
        <StickyCardCell position="first" className="px-4 py-1.5 text-[15px] font-semibold text-muted-foreground whitespace-nowrap">
          Ingresos
        </StickyCardCell>
        {months.map((mes) => {
          const val = ingresosPorMes[mes];
          const hasVal = val != null && val > 0;
          const hasHeatmap = ingresosReady && hasVal;
          const fill = hasHeatmap ? heatmapFill(val, minIngresos, maxIngresos) : null;
          return (
            <td
              key={mes}
              className={cn(
                "text-right px-3 py-1.5 text-[15px] font-semibold tabular-nums whitespace-nowrap transition-opacity",
                cardCellClasses("first", "mid"),
                !fill && (val == null ? "text-muted-foreground/40" : "text-[#159457]"),
                hasVal && onIngresoCellClick && "cursor-pointer hover:opacity-75"
              )}
              style={fill ? { backgroundColor: fill.background, color: fill.foreground } : undefined}
              onClick={() => { if (hasVal) onIngresoCellClick?.(mes); }}
            >
              {fmtARS(val)}
            </td>
          );
        })}
        <td
          className={cn(
            "text-right px-4 py-1.5 text-[15px] font-semibold tabular-nums text-[#159457] whitespace-nowrap",
            cardCellClasses("first", "mid"),
            ingresosTotal && onIngresoTotalClick && "cursor-pointer hover:opacity-75"
          )}
          onClick={() => { if (ingresosTotal) onIngresoTotalClick?.(); }}
        >
          {fmtARS(ingresosTotal)}
        </td>
        <td className={cardCellClasses("first", "right")} />
      </tr>

      <tr>
        <StickyCardCell position="middle" className="px-4 py-1.5 font-medium text-muted-foreground whitespace-nowrap">
          Egresos
        </StickyCardCell>
        {months.map((mes) => (
          <td key={mes} className={cn("text-right px-3 py-1.5 tabular-nums text-muted-foreground whitespace-nowrap", cardCellClasses("middle", "mid"))}>
            {fmtARS(egresosPorMes[mes])}
          </td>
        ))}
        <td className={cn("text-right px-4 py-1.5 font-medium tabular-nums text-muted-foreground whitespace-nowrap", cardCellClasses("middle", "mid"))}>
          {fmtARS(egresosTotal)}
        </td>
        <td className={cardCellClasses("middle", "right")} />
      </tr>

      <tr>
        <StickyCardCell position="middle" className="px-4 py-1.5 font-bold whitespace-nowrap">
          Resultado OP
        </StickyCardCell>
        {months.map((mes) => {
          const ingVal = ingresosPorMes[mes];
          const egrVal = egresosPorMes[mes];
          const noData = ingVal == null && egrVal == null;
          const res = (ingVal ?? 0) - (egrVal ?? 0);
          return (
            <td
              key={mes}
              className={cn(
                "text-right px-3 py-1.5 font-semibold tabular-nums whitespace-nowrap",
                cardCellClasses("middle", "mid"),
                noData ? "text-muted-foreground/40" : res < 0 ? "text-destructive" : "text-foreground"
              )}
            >
              {fmtARS(res || undefined)}
            </td>
          );
        })}
        {(() => {
          const res = (ingresosTotal ?? 0) - egresosTotal;
          return (
            <td className={cn("text-right px-4 py-1.5 font-bold tabular-nums whitespace-nowrap", cardCellClasses("middle", "mid"), res < 0 ? "text-destructive" : "text-foreground")}>
              {fmtARS(res || undefined)}
            </td>
          );
        })()}
        <td className={cardCellClasses("middle", "right")} />
      </tr>

      <tr>
        <StickyCardCell position="last" className="px-4 py-1.5 font-medium text-muted-foreground whitespace-nowrap">
          Gastos / Ventas
        </StickyCardCell>
        {months.map((mes) => {
          const ing = ingresosPorMes[mes] ?? 0;
          const egr = egresosPorMes[mes] ?? 0;
          const ratio = ing > 0 ? (egr / ing) * 100 : null;
          return (
            <td key={mes} className={cn(
              "text-right px-3 py-1.5 font-medium tabular-nums whitespace-nowrap",
              cardCellClasses("last", "mid"),
              ratio === null ? "text-muted-foreground/40"
                : ratio > 90 ? "text-destructive"
                : ratio > 60 ? "text-warning"
                : "text-muted-foreground"
            )}>
              {ratio !== null ? `${ratio.toFixed(1)}%` : "—"}
            </td>
          );
        })}
        {(() => {
          const ratio = (ingresosTotal ?? 0) > 0 ? (egresosTotal / (ingresosTotal ?? 0)) * 100 : null;
          return (
            <td className={cn(
              "text-right px-4 py-1.5 font-semibold tabular-nums whitespace-nowrap",
              cardCellClasses("last", "mid"),
              ratio === null ? "text-muted-foreground/40"
                : ratio > 90 ? "text-destructive"
                : ratio > 60 ? "text-warning"
                : "text-muted-foreground"
            )}>
              {ratio !== null ? `${ratio.toFixed(1)}%` : "—"}
            </td>
          );
        })()}
        <td className={cardCellClasses("last", "right")} />
      </tr>
    </>
  );
}
