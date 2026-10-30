import { ChevronDown, ChevronUp, Layers } from "lucide-react";
import { SectionDivider } from "./section-divider";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { KpiBlock } from "./kpi-block";
import type { SortCol, SortDir } from "@/lib/dashboard/pivot-utils";

interface PivotTableHeadProps {
  months: number[];
  sortCol: SortCol;
  sortDir: SortDir;
  onSortClick: (col: SortCol) => void;
  pctMode: "ingresos" | "egresos";
  onTogglePctMode: () => void;
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  ingresosTotal: number | undefined;
  egresosTotal: number;
  ingresosReady: boolean;
  onIngresoCellClick: (mes: number) => void;
  onIngresoTotalClick: () => void;
}

// <thead> completo de la tabla pivot de compras (headers de mes/Total/% + KpiBlock
// + separador "Gastos por rubro") — idéntico byte a byte entre
// pivot-table-por-concepto.tsx y pivot-table-por-proveedor.tsx antes de esta
// extracción.
export function PivotTableHead({
  months,
  sortCol,
  sortDir,
  onSortClick,
  pctMode,
  onTogglePctMode,
  ingresosPorMes,
  egresosPorMes,
  ingresosTotal,
  egresosTotal,
  ingresosReady,
  onIngresoCellClick,
  onIngresoTotalClick,
}: PivotTableHeadProps) {
  return (
    <thead>
      <tr className="bg-muted border-b">
        <th className="sticky left-0 top-0 z-30 bg-muted text-left px-4 py-3 font-medium text-muted-foreground min-w-[150px] md:min-w-[200px] whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
          {/* Rediseño (Diego 30/10/2026): meses arriba, Operación (KpiBlock) y después Gastos por rubro en
              su propio bloque; las vistas Concepto/Proveedor/Insumos y $/% pasaron a la barra de la tarjeta. */}
          Operación
        </th>
        {months.map((idx) => (
          <th
            key={idx}
            className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium min-w-[90px] whitespace-nowrap"
          >
            <button
              onClick={() => onSortClick(idx)}
              className={cn(
                "inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors",
                sortCol === idx ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {MONTHS[idx - 1]}
              {sortCol === idx ? (
                sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
              ) : (
                sortDir === "desc" ? <ChevronDown className="w-3 h-3 opacity-40" /> : <ChevronUp className="w-3 h-3 opacity-40" />
              )}
            </button>
          </th>
        ))}
        <th className="sticky top-0 z-20 bg-muted text-right px-4 py-3 font-semibold text-[15px] min-w-[110px] whitespace-nowrap">
          <button
            onClick={() => onSortClick("total")}
            className={cn(
              "inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors",
              sortCol === "total" ? "text-foreground" : "text-muted-foreground"
            )}
          >
            Total
            {sortCol === "total" ? (
              sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
            ) : (
              sortDir === "desc" ? <ChevronDown className="w-3 h-3 opacity-40" /> : <ChevronUp className="w-3 h-3 opacity-40" />
            )}
          </button>
        </th>
        <th
          className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium text-muted-foreground min-w-[64px] whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
          onClick={onTogglePctMode}
          title={pctMode === "ingresos" ? "% sobre ingresos — click para cambiar a % sobre egresos" : "% sobre egresos — click para cambiar a % sobre ingresos"}
        >
          % {pctMode === "ingresos" ? "ing" : "egr"}
        </th>
      </tr>
      <KpiBlock
        months={months}
        ingresosPorMes={ingresosPorMes}
        egresosPorMes={egresosPorMes}
        ingresosTotal={ingresosTotal}
        egresosTotal={egresosTotal}
        ingresosReady={ingresosReady}
        variant="borderless"
        onIngresoCellClick={onIngresoCellClick}
        onIngresoTotalClick={onIngresoTotalClick}
      />
      <SectionDivider label="Gastos por rubro" icon={Layers} colSpan={months.length + 3} />
    </thead>
  );
}
