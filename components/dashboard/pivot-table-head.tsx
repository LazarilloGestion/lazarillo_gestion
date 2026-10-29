import { ChevronDown, ChevronUp, Package, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { KpiBlock } from "./kpi-block";
import type { SortCol, SortDir } from "@/lib/dashboard/pivot-utils";
import type { AgrupacionCompras } from "@/lib/dashboard/params";
import type { ModoCelda } from "@/hooks/use-pct-mode";

interface PivotTableHeadProps {
  months: number[];
  sortCol: SortCol;
  sortDir: SortDir;
  onSortClick: (col: SortCol) => void;
  agrupacionCompras: AgrupacionCompras;
  onAgrupacionChange: (a: AgrupacionCompras) => void;
  // Toggle $ / % ing de las celdas mensuales (punto 6 Etapa 3).
  modoCelda: ModoCelda;
  onModoCeldaChange: (m: ModoCelda) => void;
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

// <thead> completo de la tabla pivot de compras (KpiBlock + fila de toggle
// Concepto/Proveedor + headers de mes/Total/%) — idéntico byte a byte entre
// pivot-table-por-concepto.tsx y pivot-table-por-proveedor.tsx antes de esta
// extracción.
export function PivotTableHead({
  months,
  sortCol,
  sortDir,
  onSortClick,
  agrupacionCompras,
  onAgrupacionChange,
  modoCelda,
  onModoCeldaChange,
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
  const toggles = (
    <>
      <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5 w-fit align-middle">
        <button
          onClick={() => onAgrupacionChange("concepto")}
          aria-pressed={agrupacionCompras === "concepto"}
          className={cn(
            "h-7 px-2.5 rounded-md text-xs font-medium transition-all",
            agrupacionCompras === "concepto"
              ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Concepto
        </button>
        <button
          onClick={() => onAgrupacionChange("proveedor")}
          aria-pressed={agrupacionCompras === "proveedor"}
          className={cn(
            "h-7 px-2.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1",
            agrupacionCompras === "proveedor"
              ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="w-3 h-3" />
          Proveedor
        </button>
        <button
          onClick={() => onAgrupacionChange("insumo")}
          aria-pressed={agrupacionCompras === "insumo"}
          title="Cada gasto por sus insumos (informe 25); sin detalle, por su concepto"
          className={cn(
            "h-7 px-2.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1",
            agrupacionCompras === "insumo"
              ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Package className="w-3 h-3" />
          Insumos
        </button>
      </div>
      {/* Toggle $ / % ing: cada celda mensual pasa a mostrar su peso sobre los
          ingresos de ese mes (el "% ing" de la columna Total, mes a mes). */}
      <div className="ml-2 inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5 w-fit align-middle">
        <button
          onClick={() => onModoCeldaChange("importe")}
          aria-pressed={modoCelda === "importe"}
          title="Celdas en pesos"
          className={cn(
            "h-7 px-2.5 rounded-md text-xs font-medium transition-all",
            modoCelda === "importe"
              ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          $
        </button>
        <button
          onClick={() => onModoCeldaChange("pct")}
          aria-pressed={modoCelda === "pct"}
          title="Celdas como % de los ingresos de cada mes"
          className={cn(
            "h-7 px-2.5 rounded-md text-xs font-medium transition-all",
            modoCelda === "pct"
              ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          % ing
        </button>
      </div>
    </>
  );

  return (
    <thead>
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
      <tr className="lg:hidden bg-muted">
        <td colSpan={months.length + 3} className="pt-2.5 pb-0.5">
          <div className="sticky left-0 z-10 flex w-fit flex-wrap items-center gap-y-1.5 px-4">{toggles}</div>
        </td>
      </tr>
      <tr className="bg-muted border-b">
        <th className="sticky left-0 top-0 z-30 bg-muted text-left px-4 py-3 font-medium text-muted-foreground min-w-[150px] md:min-w-[240px] whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
          {/* En pantallas chicas (celu, también apaisado) los botones van en su propia fila de arriba:
              acá estiraban la 1ª columna a todo el ancho y los meses quedaban afuera. */}
          <span className="hidden lg:inline">{toggles}</span>
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
    </thead>
  );
}
