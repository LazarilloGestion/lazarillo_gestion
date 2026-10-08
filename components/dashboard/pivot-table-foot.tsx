import { cn, fmtARS } from "@/lib/utils";
import { hasValue } from "@/lib/dashboard/pivot-utils";

interface PivotTableFootProps {
  year: number;
  months: number[];
  columnTotals: Record<number, number>;
  grandTotal: number;
  pctMode: "ingresos" | "egresos";
  fmtPct: (rowTotal: number) => string;
  // Opcionales: sin callback la celda se renderiza como texto plano.
  onMonthClick?: (mes: number) => void;
  onTotalClick?: () => void;
}

// hover:bg-accent y no hover:text-primary: la celda de total ya es text-primary
// (sin cambio visible) y el fondo del footer es bg-muted.
const CLICKABLE = "cursor-pointer hover:bg-accent transition-colors";

// <tfoot> completo de la tabla pivot de compras — idéntico byte a byte entre
// pivot-table-por-concepto.tsx y pivot-table-por-proveedor.tsx antes de esta
// extracción. Los totales por mes/año abren el detalle del período (pedido
// del cliente: buscar registros por período, no solo por rubro).
export function PivotTableFoot({
  year, months, columnTotals, grandTotal, pctMode, fmtPct, onMonthClick, onTotalClick,
}: PivotTableFootProps) {
  const totalClickable = onTotalClick && hasValue(grandTotal);
  return (
    <tfoot>
      <tr className="border-t-2 bg-muted font-semibold text-[15px]">
        <td className="sticky left-0 z-10 bg-muted px-4 py-3 shadow-[1px_0_0_0_hsl(var(--border))]">
          Total {year}
        </td>
        {months.map((mes) => {
          const clickable = onMonthClick && hasValue(columnTotals[mes]);
          return (
            <td
              key={mes}
              className={cn("text-right px-3 py-3 tabular-nums bg-muted", clickable && CLICKABLE)}
              onClick={clickable ? () => onMonthClick?.(mes) : undefined}
            >
              {fmtARS(columnTotals[mes])}
            </td>
          );
        })}
        <td
          className={cn("text-right px-4 py-3 tabular-nums text-primary bg-muted", totalClickable && CLICKABLE)}
          onClick={totalClickable ? onTotalClick : undefined}
        >
          {fmtARS(grandTotal)}
        </td>
        <td className="text-right px-3 py-3 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap font-semibold bg-muted">
          {pctMode === "egresos" ? "—" : fmtPct(grandTotal)}
        </td>
      </tr>
    </tfoot>
  );
}
