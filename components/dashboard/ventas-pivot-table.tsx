"use client";
import { useCallback, useMemo, useState } from "react";
import { useExpandableSet } from "@/hooks/use-expandable-set";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { buildVentasPivotUrl } from "@/lib/dashboard/params";
import { flattenRows, sortPivotRows, hasValue } from "@/lib/dashboard/pivot-utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import type {
  PivotData,
  PivotRubroRow,
  PivotConceptoRow,
  VentasDetalleFilter,
} from "@/lib/dashboard/types";
import { VentasDetalleModal } from "./ventas-detalle-modal";

export function VentasPivotTable() {
  const { year, localId, pdvId, months, activeMonths, sortCol, sortDir, handleSortClick } = useDashboard();

  const { expanded, setExpanded, toggle: toggleRow, collapseAll } = useExpandableSet();
  const [detalleFilter, setDetalleFilter] = useState<VentasDetalleFilter | null>(null);

  const url = useMemo(
    () => buildVentasPivotUrl("/api/dashboard/pivot-ventas", { year, localId, pdvId, months: activeMonths }),
    [year, localId, pdvId, activeMonths]
  );

  const { data, isLoading, error } = useFetchQuery<PivotData>(
    ["pivot-ventas", year, localId, pdvId, months],
    url
  );

  function openDetalle(extra: Omit<VentasDetalleFilter, "year" | "localId" | "pdvId">) {
    setDetalleFilter({ year, localId, pdvId, ...extra });
  }

  const sortedRows = useMemo(
    () => (data ? sortPivotRows(data.rows, sortCol, sortDir) : []),
    [data, sortCol, sortDir]
  );

  const flatRows = useMemo(
    () => (data ? flattenRows({ rows: sortedRows, columnTotals: data.columnTotals, grandTotal: data.grandTotal }, expanded, 2) : []),
    [sortedRows, expanded]
  );

  const rubroIds = useMemo(() => new Set(sortedRows.map(r => r.id)), [sortedRows]);

  const collapseConceptos = useCallback((e: React.MouseEvent) => {
    if (navigator.maxTouchPoints > 0) return;
    e.preventDefault();
    setExpanded(prev => new Set([...prev].filter(id => rubroIds.has(id))));
  }, [rubroIds, setExpanded]);

  if (isLoading) return <PivotLoading />;
  if (error) return <PivotError />;
  if (!data || data.rows.length === 0) return <PivotEmpty />;

  return (
    <>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="bg-muted border-b">
              <th className="sticky left-0 top-0 z-30 bg-muted text-left px-4 py-3 font-medium text-muted-foreground min-w-[240px] whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                <span>Tipo / Forma de cobro</span>
              </th>
              {months.map((idx) => (
                <th
                  key={idx}
                  className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium min-w-[90px] whitespace-nowrap"
                >
                  <button
                    onClick={() => handleSortClick(idx)}
                    className={cn(
                      "inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors",
                      sortCol === idx ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {MONTHS[idx - 1]}
                    {sortCol === idx
                      ? sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                      : sortDir === "desc" ? <ChevronDown className="w-3 h-3 opacity-40" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
                  </button>
                </th>
              ))}
              <th className="sticky top-0 z-20 bg-muted text-right px-4 py-3 font-bold text-base min-w-[110px] whitespace-nowrap">
                <button
                  onClick={() => handleSortClick("total")}
                  className={cn(
                    "inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors",
                    sortCol === "total" ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  Total
                  {sortCol === "total"
                    ? sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                    : sortDir === "desc" ? <ChevronDown className="w-3 h-3 opacity-40" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
                </button>
              </th>
            </tr>
          </thead>

          <tbody>
            {flatRows.map((item) => {
              if (item.type === "rubro") {
                const tipo = item.data as PivotRubroRow;
                const isExpanded = expanded.has(tipo.id);
                return (
                  <tr
                    key={tipo.id}
                    className="border-b bg-muted/25 font-semibold hover:bg-muted/50 transition-colors"
                    onContextMenu={collapseAll}
                  >
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <ExpandableButton isExpanded={isExpanded} onClick={() => toggleRow(tipo.id)}>
                        {normalize(tipo.nombre)}
                      </ExpandableButton>
                    </td>
                    {months.map((mes) => (
                      <td
                        key={mes}
                        className={cn(
                          "text-right px-3 py-2.5 tabular-nums",
                          hasValue(tipo.values[mes]) && "cursor-pointer hover:text-primary"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasValue(tipo.values[mes]))
                            openDetalle({ mes, tipoCodigo: tipo.rubroCodigo });
                        }}
                      >
                        {fmtARS(tipo.values[mes])}
                      </td>
                    ))}
                    <td
                      className="text-right px-4 py-2.5 tabular-nums font-bold text-base cursor-pointer hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetalle({ tipoCodigo: tipo.rubroCodigo });
                      }}
                    >
                      {fmtARS(tipo.rowTotal)}
                    </td>
                  </tr>
                );
              }

              const cobro = item.data as PivotConceptoRow;
              return (
                <tr
                  key={cobro.id}
                  className="border-b hover:bg-accent/40 transition-colors"
                  onContextMenu={collapseConceptos}
                >
                  <td className="sticky left-0 z-10 bg-background px-4 py-2 shadow-[1px_0_0_0_hsl(var(--border))]">
                    <span className="pl-7 block text-left">{normalize(cobro.nombre)}</span>
                  </td>
                  {months.map((mes) => (
                    <td
                      key={mes}
                      className={cn(
                        "text-right px-3 py-2 tabular-nums text-muted-foreground",
                        hasValue(cobro.values[mes]) && "cursor-pointer hover:text-foreground"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasValue(cobro.values[mes]))
                          openDetalle({
                            mes,
                            tipoCodigo: cobro.rubroCodigo,
                            cobroCodigo: cobro.conceptoCodigo,
                          });
                      }}
                    >
                      {fmtARS(cobro.values[mes])}
                    </td>
                  ))}
                  <td
                    className="text-right px-4 py-2 tabular-nums text-muted-foreground font-semibold text-sm cursor-pointer hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDetalle({
                        tipoCodigo: cobro.rubroCodigo,
                        cobroCodigo: cobro.conceptoCodigo,
                      });
                    }}
                  >
                    {fmtARS(cobro.rowTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t-2 bg-muted font-bold text-base">
              <td className="sticky left-0 z-10 bg-muted px-4 py-3 shadow-[1px_0_0_0_hsl(var(--border))]">
                Total {year}
              </td>
              {months.map((mes) => (
                <td key={mes} className="text-right px-3 py-3 tabular-nums bg-muted">
                  {fmtARS(data.columnTotals[mes])}
                </td>
              ))}
              <td className="text-right px-4 py-3 tabular-nums text-primary bg-muted">
                {fmtARS(data.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <VentasDetalleModal
        filter={detalleFilter}
        onClose={() => setDetalleFilter(null)}
      />
    </>
  );
}
