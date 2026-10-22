import { ExpandableButton } from "@/components/ui/expandable-button";
import { cn, fmtARS } from "@/lib/utils";
import { hasValue } from "@/lib/dashboard/pivot-utils";

// Subconjunto estructural de PivotRubroRow / PivotRubroRowPorProveedor
// (@/lib/dashboard/types) — ambos son compatibles con esto sin cast, ya que
// esta fila no toca `children`.
interface RubroRowData {
  id: string;
  nombre: string;
  rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
}

interface RubroRowProps {
  rubro: RubroRowData;
  months: number[];
  isExpanded: boolean;
  onToggle: () => void;
  onCollapseAll: (e: React.MouseEvent) => void;
  onCellClick: (mes: number, rubroCodigo: string) => void;
  onTotalClick: (rubroCodigo: string) => void;
  fmtPct: (rowTotal: number) => string;
  // Celda mensual según el toggle $ / % ing (el Total sigue en $).
  fmtCelda: (valor: number | undefined, mes: number) => string;
}

// Fila de nivel superior ("rubro") de la tabla pivot de compras — idéntica
// byte a byte entre pivot-table-por-concepto.tsx y
// pivot-table-por-proveedor.tsx antes de esta extracción. El caller pone
// `key={rubro.id}` en el elemento <RubroRow> al usarlo.
export function RubroRow({ rubro, months, isExpanded, onToggle, onCollapseAll, onCellClick, onTotalClick, fmtPct, fmtCelda }: RubroRowProps) {
  return (
    <tr className="border-b font-semibold" onContextMenu={onCollapseAll}>
      <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
        <ExpandableButton isExpanded={isExpanded} onClick={onToggle}>
          {rubro.nombre}
        </ExpandableButton>
      </td>
      {months.map((mes) => (
        <td
          key={mes}
          className={cn(
            "text-right px-3 py-2.5 tabular-nums bg-muted/25 hover:bg-muted/50 transition-colors",
            hasValue(rubro.values[mes]) && "cursor-pointer hover:text-primary"
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (hasValue(rubro.values[mes])) onCellClick(mes, rubro.rubroCodigo);
          }}
        >
          {fmtCelda(rubro.values[mes], mes)}
        </td>
      ))}
      <td
        className="text-right px-4 py-2.5 tabular-nums font-semibold text-[15px] bg-muted/25 hover:bg-muted/50 transition-colors cursor-pointer hover:text-primary"
        onClick={(e) => {
          e.stopPropagation();
          onTotalClick(rubro.rubroCodigo);
        }}
      >
        {fmtARS(rubro.rowTotal)}
      </td>
      <td className="text-right px-3 py-2.5 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap bg-muted/25 hover:bg-muted/50 transition-colors">
        {fmtPct(rubro.rowTotal)}
      </td>
    </tr>
  );
}
