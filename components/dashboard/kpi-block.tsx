import { cn, fmtARS } from "@/lib/utils";

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
  const maxIngresos = Math.max(...months.map((m) => ingresosPorMes[m] ?? 0), 1);

  function ingresosColor(mes: number): string {
    const v = ingresosPorMes[mes] ?? 0;
    const ratio = v / maxIngresos;
    const lightness = Math.round(88 - ratio * 40);
    return `hsl(142 60% ${lightness}%)`;
  }

  return (
    <>
      <tr className="border-b">
        <td className="sticky left-0 z-10 bg-background px-4 py-1.5 text-sm font-medium text-muted-foreground whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
          Ingresos
        </td>
        {months.map((mes) => {
          const val = ingresosPorMes[mes];
          const hasVal = val != null && val > 0;
          const hasHeatmap = ingresosReady && hasVal;
          return (
            <td
              key={mes}
              className={cn(
                "text-right px-3 py-1.5 text-xs font-medium tabular-nums whitespace-nowrap transition-opacity",
                !hasHeatmap && (val == null ? "text-muted-foreground/40" : "text-success"),
                hasVal && onIngresoCellClick && "cursor-pointer hover:opacity-75"
              )}
              style={{
                backgroundColor: hasHeatmap ? ingresosColor(mes) : undefined,
                color: hasHeatmap ? "hsl(142 55% 28%)" : undefined,
              }}
              onClick={() => { if (hasVal) onIngresoCellClick?.(mes); }}
            >
              {fmtARS(val)}
            </td>
          );
        })}
        <td
          className={cn(
            "text-right px-4 py-1.5 text-sm font-bold tabular-nums text-success whitespace-nowrap",
            ingresosTotal && onIngresoTotalClick && "cursor-pointer hover:opacity-75"
          )}
          onClick={() => { if (ingresosTotal) onIngresoTotalClick?.(); }}
        >
          {fmtARS(ingresosTotal)}
        </td>
        <td />
      </tr>

      <tr className="border-b">
        <td className="sticky left-0 z-10 bg-background px-4 py-1.5 text-sm font-medium text-muted-foreground whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
          Egresos
        </td>
        {months.map((mes) => (
          <td key={mes} className="text-right px-3 py-1.5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
            {fmtARS(egresosPorMes[mes])}
          </td>
        ))}
        <td className="text-right px-4 py-1.5 text-sm font-medium tabular-nums text-muted-foreground whitespace-nowrap">
          {fmtARS(egresosTotal)}
        </td>
        <td />
      </tr>

      <tr className="border-b">
        <td className="sticky left-0 z-10 bg-background px-4 py-1.5 text-sm font-bold whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
          Resultado OP
        </td>
        {months.map((mes) => {
          const ingVal = ingresosPorMes[mes];
          const egrVal = egresosPorMes[mes];
          const noData = ingVal == null && egrVal == null;
          const res = (ingVal ?? 0) - (egrVal ?? 0);
          return (
            <td
              key={mes}
              className={cn(
                "text-right px-3 py-1.5 text-xs font-semibold tabular-nums whitespace-nowrap",
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
            <td className={cn("text-right px-4 py-1.5 text-sm font-bold tabular-nums whitespace-nowrap", res < 0 ? "text-destructive" : "text-foreground")}>
              {fmtARS(res || undefined)}
            </td>
          );
        })()}
        <td />
      </tr>

      <tr className="border-b-2">
        <td className="sticky left-0 z-10 bg-background px-4 py-1.5 text-sm font-medium text-muted-foreground whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
          Gastos / Ventas
        </td>
        {months.map((mes) => {
          const ing = ingresosPorMes[mes] ?? 0;
          const egr = egresosPorMes[mes] ?? 0;
          const ratio = ing > 0 ? (egr / ing) * 100 : null;
          return (
            <td key={mes} className={cn(
              "text-right px-3 py-1.5 text-xs font-medium tabular-nums whitespace-nowrap",
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
              "text-right px-4 py-1.5 text-sm font-semibold tabular-nums whitespace-nowrap",
              ratio === null ? "text-muted-foreground/40"
                : ratio > 90 ? "text-destructive"
                : ratio > 60 ? "text-warning"
                : "text-muted-foreground"
            )}>
              {ratio !== null ? `${ratio.toFixed(1)}%` : "—"}
            </td>
          );
        })()}
        <td />
      </tr>
    </>
  );
}
