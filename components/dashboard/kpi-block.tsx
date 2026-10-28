import { cn, fmtARS } from "@/lib/utils";
import { heatmapFill, RESULT_COLORS } from "@/lib/dashboard/resultados-calc";
import { cardCellClasses } from "@/lib/dashboard/card-row-classes";
import { StickyCardCell } from "./sticky-card-cell";
import { FaltaCargarTip, ProyeccionEgresos, ProyeccionIngresos, TipProyectado } from "./proyeccion-tooltip";
import { useEgresosProyeccion } from "@/hooks/use-egresos-proyeccion";
import { useProyeccionIngresos } from "@/hooks/use-proyeccion-ingresos";
import { useDashboard } from "@/hooks/use-dashboard-store";

type KpiBlockProps = {
  months: number[];
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  ingresosTotal?: number;
  egresosTotal: number;
  ingresosReady: boolean;
  // "default": tarjeta con borde + esquinas redondeadas (Compras/Resultados originales).
  // "borderless": sin borde (Compras, dentro de un panel que ya trae su propio borde).
  // "flush-top": con borde pero sin redondeo arriba (Resultados, pegada al header de la tabla).
  variant?: "default" | "borderless" | "flush-top";
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
  variant = "default",
  onIngresoCellClick,
  onIngresoTotalClick,
}: KpiBlockProps) {
  const bordered = variant !== "borderless";
  const roundedTop = variant !== "flush-top";
  // Mes con ventas incompletas → chip "proy." + tooltip con la proyección de cierre.
  // Para el color del mapa de calor ese mes cuenta con lo proyectado, no con lo
  // facturado a medias (si no, siempre saldría como el peor mes).
  const { year } = useDashboard();
  const proy = useProyeccionIngresos();
  const mesProy = proy && proy.anio === year ? proy.mes : null;
  const valorHeatmap = (m: number) => (m === mesProy && ingresosPorMes[m] > 0 ? proy!.proyeccion : ingresosPorMes[m]);
  const ingresosVisibles = months.map(valorHeatmap).filter((v): v is number => v != null && v > 0);
  const minIngresos = ingresosVisibles.length ? Math.min(...ingresosVisibles) : 0;
  const maxIngresos = ingresosVisibles.length ? Math.max(...ingresosVisibles) : 1;
  // Las celdas muestran SIEMPRE lo real; la proyección del mes en curso y lo que falta cargar
  // en los meses cerrados van en el tooltip, también en Resultado OP y Gastos / Ventas (Diego 28/10/2026).
  const { proyectado: egrProy, ventasProy, faltan } = useEgresosProyeccion(egresosPorMes);
  const esProy = (m: number) => !!egrProy && egrProy.mes === m && ventasProy != null;
  // Ingresos y egresos "completos" del mes, para los tooltips: proyectados en el mes en curso,
  // y en los cerrados con lo que falta cargar; null si no hay nada que agregar a lo real.
  const completo = (m: number): { ing: number; egr: number; tipo: "proy" | "falta" } | null => {
    if (esProy(m)) return { ing: ventasProy!, egr: egrProy!.total, tipo: "proy" };
    if (faltan[m] && egresosPorMes[m] != null) return { ing: ingresosPorMes[m] ?? 0, egr: egresosPorMes[m] + faltan[m].total, tipo: "falta" };
    return null;
  };

  return (
    <>
      <tr>
        <StickyCardCell position="first" bordered={bordered} roundedTop={roundedTop} className="px-4 py-1.5 text-[15px] font-semibold text-muted-foreground whitespace-nowrap">
          Ingresos
        </StickyCardCell>
        {months.map((mes) => {
          const val = ingresosPorMes[mes];
          const hasVal = val != null && val > 0;
          const hasHeatmap = ingresosReady && hasVal;
          const fill = hasHeatmap ? heatmapFill(valorHeatmap(mes), minIngresos, maxIngresos) : null;
          return (
            <td
              key={mes}
              className={cn(
                "text-right px-3 py-1.5 text-[15px] font-semibold tabular-nums whitespace-nowrap transition-opacity",
                cardCellClasses("first", "mid", { border: bordered, roundedTop }),
                !fill && val == null && "text-muted-foreground/40",
                hasVal && onIngresoCellClick && "cursor-pointer hover:opacity-75"
              )}
              style={fill ? { backgroundColor: fill.background, color: fill.foreground } : val != null ? { color: RESULT_COLORS.positive } : undefined}
              onClick={() => { if (hasVal) onIngresoCellClick?.(mes); }}
            >
              {mesProy === mes && hasVal ? <ProyeccionIngresos p={proy!}>{fmtARS(val)}</ProyeccionIngresos> : fmtARS(val)}
            </td>
          );
        })}
        <td
          className={cn(
            "text-right px-4 py-1.5 text-[15px] font-semibold tabular-nums whitespace-nowrap",
            cardCellClasses("first", "mid", { border: bordered, roundedTop }),
            ingresosTotal && onIngresoTotalClick && "cursor-pointer hover:opacity-75"
          )}
          style={{ color: RESULT_COLORS.positive }}
          onClick={() => { if (ingresosTotal) onIngresoTotalClick?.(); }}
        >
          {fmtARS(ingresosTotal)}
        </td>
        <td className={cardCellClasses("first", "right", { border: bordered, roundedTop })} />
      </tr>

      <tr>
        <StickyCardCell position="middle" bordered={bordered} className="px-4 py-1.5 font-medium text-muted-foreground whitespace-nowrap">
          Egresos
        </StickyCardCell>
        {months.map((mes) => (
          <td key={mes} className={cn("text-right px-3 py-1.5 tabular-nums text-muted-foreground whitespace-nowrap", cardCellClasses("middle", "mid", { border: bordered }))}>
            {esProy(mes) ? <ProyeccionEgresos e={egrProy!} anio={year} corte={null} ventasProy={ventasProy}>{fmtARS(egresosPorMes[mes])}</ProyeccionEgresos>
              : faltan[mes] && egresosPorMes[mes] != null ? <FaltaCargarTip f={faltan[mes]} anio={year} mes={mes} real={egresosPorMes[mes]}>{fmtARS(egresosPorMes[mes])}</FaltaCargarTip>
              : fmtARS(egresosPorMes[mes])}
          </td>
        ))}
        <td className={cn("text-right px-4 py-1.5 font-medium tabular-nums text-muted-foreground whitespace-nowrap", cardCellClasses("middle", "mid", { border: bordered }))}>
          {fmtARS(egresosTotal)}
        </td>
        <td className={cardCellClasses("middle", "right", { border: bordered })} />
      </tr>

      <tr>
        <StickyCardCell position="middle" bordered={bordered} className="px-4 py-1.5 font-bold whitespace-nowrap">
          Resultado OP
        </StickyCardCell>
        {months.map((mes) => {
          const ingVal = ingresosPorMes[mes];
          const egrVal = egresosPorMes[mes];
          const comp = completo(mes);
          const noData = ingVal == null && egrVal == null;
          const res = (ingVal ?? 0) - (egrVal ?? 0);
          return (
            <td
              key={mes}
              className={cn(
                "text-right px-3 py-1.5 font-semibold tabular-nums whitespace-nowrap",
                cardCellClasses("middle", "mid", { border: bordered }),
                noData && "text-muted-foreground/40"
              )}
              style={noData ? undefined : { color: res < 0 ? RESULT_COLORS.negative : RESULT_COLORS.positive }}
            >
              {noData ? "—" : comp ? (
                <TipProyectado titulo={comp.tipo === "proy" ? "Resultado OP · proyección de cierre" : "Resultado OP · con lo que falta cargar"}
                  grande={fmtARS(comp.ing - comp.egr)} negativo={comp.ing - comp.egr < 0}
                  filas={[[comp.tipo === "proy" ? "Ventas proyectadas" : "Ventas", fmtARS(comp.ing)], [comp.tipo === "proy" ? "Egresos proyectados" : "Egresos + lo que falta cargar", `− ${fmtARS(comp.egr)}`], ["Hoy (real)", fmtARS(res)]]}>
                  {fmtARS(res)}</TipProyectado>
              ) : fmtARS(res)}
            </td>
          );
        })}
        {(() => {
          const res = (ingresosTotal ?? 0) - egresosTotal;
          return (
            <td
              className={cn("text-right px-4 py-1.5 font-bold tabular-nums whitespace-nowrap", cardCellClasses("middle", "mid", { border: bordered }))}
              style={{ color: res < 0 ? RESULT_COLORS.negative : RESULT_COLORS.positive }}
            >
              {fmtARS(res)}
            </td>
          );
        })()}
        <td className={cardCellClasses("middle", "right", { border: bordered })} />
      </tr>

      <tr>
        <StickyCardCell position="last" bordered={bordered} className="px-4 py-1.5 font-medium text-muted-foreground whitespace-nowrap">
          Gastos / Ventas
        </StickyCardCell>
        {months.map((mes) => {
          const ing = ingresosPorMes[mes] ?? 0;
          const egr = egresosPorMes[mes] ?? 0;
          const comp = completo(mes);
          const ratio = ing > 0 ? (egr / ing) * 100 : null;
          return (
            <td
              key={mes}
              className={cn(
                "text-right px-3 py-1.5 font-medium tabular-nums whitespace-nowrap",
                cardCellClasses("last", "mid", { border: bordered }),
                ratio === null && "text-muted-foreground/40"
              )}
              style={ratio === null ? undefined : { color: ratio > 90 ? RESULT_COLORS.negative : ratio > 60 ? RESULT_COLORS.neutral : RESULT_COLORS.positive }}
            >
              {ratio === null ? "—" : comp && comp.ing > 0 ? (
                <TipProyectado titulo={comp.tipo === "proy" ? "Gastos / Ventas · proyección de cierre" : "Gastos / Ventas · con lo que falta cargar"}
                  grande={`${((comp.egr / comp.ing) * 100).toFixed(1)}%`} filas={[["Hoy (real)", `${ratio.toFixed(1)}%`]]}>
                  {ratio.toFixed(1)}%</TipProyectado>
              ) : `${ratio.toFixed(1)}%`}
            </td>
          );
        })}
        {(() => {
          const ratio = (ingresosTotal ?? 0) > 0 ? (egresosTotal / (ingresosTotal ?? 0)) * 100 : null;
          return (
            <td
              className={cn(
                "text-right px-4 py-1.5 font-semibold tabular-nums whitespace-nowrap",
                cardCellClasses("last", "mid", { border: bordered }),
                ratio === null && "text-muted-foreground/40"
              )}
              style={ratio === null ? undefined : { color: ratio > 90 ? RESULT_COLORS.negative : ratio > 60 ? RESULT_COLORS.neutral : RESULT_COLORS.positive }}
            >
              {ratio !== null ? `${ratio.toFixed(1)}%` : "—"}
            </td>
          );
        })()}
        <td className={cardCellClasses("last", "right", { border: bordered })} />
      </tr>
    </>
  );
}
