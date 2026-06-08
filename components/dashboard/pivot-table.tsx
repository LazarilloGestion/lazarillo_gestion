"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExpandableSet } from "@/hooks/use-expandable-set";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { buildDashboardUrl, buildVentasPivotUrl } from "@/lib/dashboard/params";
import { flattenRows, sortPivotRows, hasValue } from "@/lib/dashboard/pivot-utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import type {
  PivotData,
  PivotRubroRow,
  PivotConceptoRow,
  DetalleFilter,
  VentasDetalleFilter,
} from "@/lib/dashboard/types";
import { DetalleModal } from "./detalle-modal";
import { VentasDetalleModal } from "./ventas-detalle-modal";


export function PivotTable() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion,
  } = useDashboard();

  const { expanded, setExpanded, toggle: toggleRow, collapseAll } = useExpandableSet();
  const [detalleFilter, setDetalleFilter] = useState<DetalleFilter | null>(null);
  const [ventasDetalleFilter, setVentasDetalleFilter] = useState<VentasDetalleFilter | null>(null);
  const [pctMode, setPctMode] = useState<"ingresos" | "egresos">("ingresos");
  const prevFilterRef = useRef<{ conceptoCodigo?: string; proveedorId?: number }>({});


  const url = useMemo(() => {
    const base = buildDashboardUrl("/api/dashboard/pivot", {
      year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, months: activeMonths,
    });
    return rubroConfigVersion > 0 ? `${base}&_rcv=${rubroConfigVersion}` : base;
  }, [year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, activeMonths, rubroConfigVersion]);

  const { data, isLoading, error } = useFetchQuery<PivotData>(
    ["pivot", year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, months, rubroConfigVersion],
    url
  );

  const ventasUrl = useMemo(
    () => buildVentasPivotUrl("/api/dashboard/pivot-ventas", { year, localId, pdvId, months: activeMonths }),
    [year, localId, pdvId, activeMonths]
  );

  const { data: ventasData, isLoading: ventasLoading } = useFetchQuery<PivotData>(
    ["pivot-ventas", year, localId, pdvId, months],
    ventasUrl
  );

  // Auto-expandir cuando hay filtro de concepto o proveedor; colapsar al quitar filtro.
  useEffect(() => {
    if (!data) return;
    const prev = prevFilterRef.current;
    const filterChanged =
      prev.conceptoCodigo !== conceptoCodigo || prev.proveedorId !== proveedorId;
    prevFilterRef.current = { conceptoCodigo, proveedorId };
    if (!filterChanged) return;

    if (conceptoCodigo || proveedorId) {
      const ids = new Set<string>();
      for (const rubro of data.rows) {
        ids.add(rubro.id);
        for (const concepto of rubro.children) ids.add(concepto.id);
      }
      setExpanded(ids);
    } else {
      setExpanded(new Set());
    }
  }, [data, conceptoCodigo, proveedorId]);

  function openDetalle(extra: Omit<DetalleFilter, "year" | "localId" | "pdvId">) {
    setDetalleFilter({ year, localId, pdvId, ...extra });
  }

  const sortedRows = useMemo(
    () => (data ? sortPivotRows(data.rows, sortCol, sortDir) : []),
    [data, sortCol, sortDir]
  );

  const flatRows = useMemo(
    () => flattenRows({ rows: sortedRows, columnTotals: data?.columnTotals ?? {}, grandTotal: data?.grandTotal ?? 0 }, expanded, 3),
    [sortedRows, expanded, data]
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

  const pctDenominator = pctMode === "ingresos"
    ? (ventasData?.grandTotal ?? 0)
    : data.grandTotal;

  function fmtPct(rowTotal: number): string {
    if (pctMode === "ingresos" && ventasLoading) return "…";
    return pctDenominator > 0 ? `${((rowTotal / pctDenominator) * 100).toFixed(1)}%` : "—";
  }

  const ingresosPorMes = ventasData?.columnTotals ?? {};
  const egresosPorMes = data.columnTotals;
  const maxIngresos = Math.max(...months.map((m) => ingresosPorMes[m] ?? 0), 1);

  function ingresosColor(mes: number): string {
    const v = ingresosPorMes[mes] ?? 0;
    const ratio = v / maxIngresos;
    const lightness = Math.round(88 - ratio * 40);
    return `hsl(142 60% ${lightness}%)`;
  }

  return (
    <>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            {/* KPI rows */}
            <tr className="border-b bg-background">
              <td className="sticky left-0 z-10 bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                Ingresos
              </td>
              {months.map((mes) => (
                <td
                  key={mes}
                  className={cn("text-right px-3 py-1.5 text-xs font-medium tabular-nums whitespace-nowrap transition-opacity", (ingresosPorMes[mes] ?? 0) > 0 && "cursor-pointer hover:opacity-75")}
                  style={{ backgroundColor: ventasData ? ingresosColor(mes) : undefined, color: "hsl(142 55% 28%)" }}
                  onClick={() => { if ((ingresosPorMes[mes] ?? 0) > 0) setVentasDetalleFilter({ year, localId, pdvId, mes }); }}
                >
                  {fmtARS(ingresosPorMes[mes])}
                </td>
              ))}
              <td
                className={cn("text-right px-4 py-1.5 text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-400 whitespace-nowrap", ventasData?.grandTotal && "cursor-pointer hover:opacity-75")}
                onClick={() => { if (ventasData?.grandTotal) setVentasDetalleFilter({ year, localId, pdvId }); }}
              >
                {fmtARS(ventasData?.grandTotal)}
              </td>
              <td />
            </tr>
            <tr className="border-b bg-background">
              <td className="sticky left-0 z-10 bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                Egresos
              </td>
              {months.map((mes) => (
                <td key={mes} className="text-right px-3 py-1.5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                  {fmtARS(egresosPorMes[mes])}
                </td>
              ))}
              <td className="text-right px-4 py-1.5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                {fmtARS(data.grandTotal)}
              </td>
              <td />
            </tr>
            <tr className="border-b">
              <td className="sticky left-0 z-10 bg-background px-4 py-1.5 text-xs font-semibold whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                Resultado OP
              </td>
              {months.map((mes) => {
                const ing = ingresosPorMes[mes] ?? 0;
                const egr = egresosPorMes[mes] ?? 0;
                const res = ing - egr;
                return (
                  <td
                    key={mes}
                    className={cn(
                      "text-right px-3 py-1.5 text-xs font-semibold tabular-nums whitespace-nowrap",
                      res < 0 ? "text-destructive" : "text-foreground"
                    )}
                  >
                    {fmtARS(res || undefined)}
                  </td>
                );
              })}
              {(() => {
                const res = (ventasData?.grandTotal ?? 0) - data.grandTotal;
                return (
                  <td className={cn("text-right px-4 py-1.5 text-xs font-semibold tabular-nums whitespace-nowrap", res < 0 ? "text-destructive" : "text-foreground")}>
                    {fmtARS(res || undefined)}
                  </td>
                );
              })()}
              <td />
            </tr>
            <tr className="border-b bg-background">
              <td className="sticky left-0 z-10 bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
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
                      : ratio > 60 ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                  )}>
                    {ratio !== null ? `${ratio.toFixed(1)}%` : "—"}
                  </td>
                );
              })}
              {(() => {
                const ventasTotal = ventasData?.grandTotal ?? 0;
                const ratio = ventasTotal > 0 ? (data.grandTotal / ventasTotal) * 100 : null;
                return (
                  <td className={cn(
                    "text-right px-4 py-1.5 text-xs font-medium tabular-nums whitespace-nowrap",
                    ratio === null ? "text-muted-foreground/40"
                      : ratio > 90 ? "text-destructive"
                      : ratio > 60 ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                  )}>
                    {ratio !== null ? `${ratio.toFixed(1)}%` : "—"}
                  </td>
                );
              })()}
              <td />
            </tr>
            <tr className="bg-muted border-b">
              <th className="sticky left-0 top-0 z-30 bg-muted text-left px-4 py-3 font-medium text-muted-foreground min-w-[240px] whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                Concepto / Proveedor
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
                    {sortCol === idx ? (
                      sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                    ) : (
                      sortDir === "desc" ? <ChevronDown className="w-3 h-3 opacity-40" /> : <ChevronUp className="w-3 h-3 opacity-40" />
                    )}
                  </button>
                </th>
              ))}
              <th className="sticky top-0 z-20 bg-muted text-right px-4 py-3 font-medium min-w-[110px] whitespace-nowrap">
                <button
                  onClick={() => handleSortClick("total")}
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
                onClick={() => setPctMode((m) => m === "ingresos" ? "egresos" : "ingresos")}
                title={pctMode === "ingresos" ? "% sobre ingresos — click para cambiar a % sobre egresos" : "% sobre egresos — click para cambiar a % sobre ingresos"}
              >
                % {pctMode === "ingresos" ? "ing" : "egr"}
              </th>
            </tr>
          </thead>

          <tbody>
            {flatRows.map((item) => {
              if (item.type === "rubro") {
                const rubro = item.data as PivotRubroRow;
                const isExpanded = expanded.has(rubro.id);
                return (
                  <tr
                    key={rubro.id}
                    className="border-b bg-muted/25 font-semibold hover:bg-muted/50 transition-colors"
                    onContextMenu={collapseAll}
                  >
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <ExpandableButton isExpanded={isExpanded} onClick={() => toggleRow(rubro.id)}>
                        {rubro.nombre}
                      </ExpandableButton>
                    </td>
                    {months.map((mes) => (
                      <td
                        key={mes}
                        className={cn(
                          "text-right px-3 py-2.5 tabular-nums",
                          hasValue(rubro.values[mes]) && "cursor-pointer hover:text-primary"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasValue(rubro.values[mes]))
                            openDetalle({ mes, rubroCodigo: rubro.rubroCodigo });
                        }}
                      >
                        {fmtARS(rubro.values[mes])}
                      </td>
                    ))}
                    <td
                      className="text-right px-4 py-2.5 tabular-nums cursor-pointer hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetalle({ rubroCodigo: rubro.rubroCodigo });
                      }}
                    >
                      {fmtARS(rubro.rowTotal)}
                    </td>
                    <td className="text-right px-3 py-2.5 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap">
                      {fmtPct(rubro.rowTotal)}
                    </td>
                  </tr>
                );
              }

              if (item.type === "concepto") {
                const concepto = item.data as PivotConceptoRow;
                const isExpanded = expanded.has(concepto.id);
                return (
                  <tr
                    key={concepto.id}
                    className="border-b hover:bg-accent/40 transition-colors"
                    onContextMenu={collapseConceptos}
                  >
                    <td className="sticky left-0 z-10 bg-background px-4 py-2 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <ExpandableButton isExpanded={isExpanded} onClick={() => toggleRow(concepto.id)} indent="pl-5" iconSize="w-3.5 h-3.5">
                        {concepto.nombre}
                      </ExpandableButton>
                    </td>
                    {months.map((mes) => (
                      <td
                        key={mes}
                        className={cn(
                          "text-right px-3 py-2 tabular-nums text-muted-foreground",
                          hasValue(concepto.values[mes]) && "cursor-pointer hover:text-foreground"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasValue(concepto.values[mes]))
                            openDetalle({ mes, conceptoCodigo: concepto.conceptoCodigo });
                        }}
                      >
                        {fmtARS(concepto.values[mes])}
                      </td>
                    ))}
                    <td
                      className="text-right px-4 py-2 tabular-nums text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetalle({ conceptoCodigo: concepto.conceptoCodigo });
                      }}
                    >
                      {fmtARS(concepto.rowTotal)}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums text-xs text-muted-foreground/50 whitespace-nowrap">
                      {fmtPct(concepto.rowTotal)}
                    </td>
                  </tr>
                );
              }

              const prov = item.data;
              return (
                <tr
                  key={prov.id}
                  className="border-b hover:bg-accent/20 transition-colors"
                >
                  <td className="sticky left-0 z-10 bg-background px-4 py-1.5 text-muted-foreground pl-14 text-xs shadow-[1px_0_0_0_hsl(var(--border))]">
                    {normalize(prov.nombre)}
                  </td>
                  {months.map((mes) => (
                    <td
                      key={mes}
                      className={cn(
                        "text-right px-3 py-1.5 tabular-nums text-muted-foreground text-xs",
                        hasValue(prov.values[mes]) && "cursor-pointer hover:text-foreground"
                      )}
                      onClick={() => {
                        if (hasValue(prov.values[mes]))
                          openDetalle({
                            mes,
                            conceptoCodigo: prov.conceptoCodigo,
                            proveedorId: prov.proveedorId ?? undefined,
                          });
                      }}
                    >
                      {fmtARS(prov.values[mes])}
                    </td>
                  ))}
                  <td
                    className="text-right px-4 py-1.5 tabular-nums text-muted-foreground text-xs cursor-pointer hover:text-foreground"
                    onClick={() =>
                      openDetalle({
                        conceptoCodigo: prov.conceptoCodigo,
                        proveedorId: prov.proveedorId ?? undefined,
                      })
                    }
                  >
                    {fmtARS(prov.rowTotal)}
                  </td>
                  <td className="text-right px-3 py-1.5 tabular-nums text-xs text-muted-foreground/40 whitespace-nowrap">
                    {fmtPct(prov.rowTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t-2 bg-muted font-semibold">
              <td className="sticky left-0 z-10 bg-muted px-4 py-3 text-sm shadow-[1px_0_0_0_hsl(var(--border))]">
                Total {year}
              </td>
              {months.map((mes) => (
                <td key={mes} className="text-right px-3 py-3 tabular-nums">
                  {fmtARS(data.columnTotals[mes])}
                </td>
              ))}
              <td className="text-right px-4 py-3 tabular-nums text-primary font-bold">
                {fmtARS(data.grandTotal)}
              </td>
              <td className="text-right px-3 py-3 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap font-semibold">
                {pctMode === "egresos" ? "—" : fmtPct(data.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <DetalleModal
        filter={detalleFilter}
        onClose={() => setDetalleFilter(null)}
      />
      <VentasDetalleModal
        filter={ventasDetalleFilter}
        onClose={() => setVentasDetalleFilter(null)}
      />

    </>
  );
}
