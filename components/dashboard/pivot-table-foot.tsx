import { fmtARS } from "@/lib/utils";

interface PivotTableFootProps {
  year: number;
  months: number[];
  columnTotals: Record<number, number>;
  grandTotal: number;
  pctMode: "ingresos" | "egresos";
  fmtPct: (rowTotal: number) => string;
}

// <tfoot> completo de la tabla pivot de compras — idéntico byte a byte entre
// pivot-table-por-concepto.tsx y pivot-table-por-proveedor.tsx antes de esta
// extracción.
export function PivotTableFoot({ year, months, columnTotals, grandTotal, pctMode, fmtPct }: PivotTableFootProps) {
  return (
    <tfoot>
      <tr className="border-t-2 bg-muted font-semibold text-[15px]">
        <td className="sticky left-0 z-10 bg-muted px-4 py-3 shadow-[1px_0_0_0_hsl(var(--border))]">
          Total {year}
        </td>
        {months.map((mes) => (
          <td key={mes} className="text-right px-3 py-3 tabular-nums bg-muted">
            {fmtARS(columnTotals[mes])}
          </td>
        ))}
        <td className="text-right px-4 py-3 tabular-nums text-primary bg-muted">
          {fmtARS(grandTotal)}
        </td>
        <td className="text-right px-3 py-3 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap font-semibold bg-muted">
          {pctMode === "egresos" ? "—" : fmtPct(grandTotal)}
        </td>
      </tr>
    </tfoot>
  );
}
