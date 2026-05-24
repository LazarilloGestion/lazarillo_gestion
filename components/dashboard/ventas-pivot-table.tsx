"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn, fmtARS } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { buildVentasPivotUrl } from "@/lib/dashboard/params";
import { flattenRows, hasValue } from "@/lib/dashboard/pivot-utils";
import { usePivotMonths } from "@/hooks/use-pivot-months";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import type {
  PivotData,
  PivotRubroRow,
  PivotConceptoRow,
  VentasDetalleFilter,
} from "@/lib/dashboard/types";
import { VentasDetalleModal } from "./ventas-detalle-modal";

export function VentasPivotTable() {
  const searchParams = useSearchParams();
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const localId = searchParams.get("localId")
    ? Number(searchParams.get("localId"))
    : undefined;
  const pdvId = searchParams.get("pdvId")
    ? Number(searchParams.get("pdvId"))
    : undefined;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detalleFilter, setDetalleFilter] = useState<VentasDetalleFilter | null>(null);

  const { months, activeMonths } = usePivotMonths();

  const url = useMemo(
    () => buildVentasPivotUrl("/api/dashboard/pivot-ventas", { year, localId, pdvId, months: activeMonths }),
    [year, localId, pdvId, activeMonths]
  );

  const { data, isLoading, error } = useQuery<PivotData>({
    queryKey: ["pivot-ventas", year, localId, pdvId, months],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Error cargando datos");
      return res.json();
    },
    staleTime: 30_000,
  });

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openDetalle(extra: Omit<VentasDetalleFilter, "year" | "localId" | "pdvId">) {
    setDetalleFilter({ year, localId, pdvId, ...extra });
  }

  const flatRows = useMemo(
    () => (data ? flattenRows(data, expanded, 2) : []),
    [data, expanded]
  );

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
                Tipo / Forma de cobro
              </th>
              {months.map((idx) => (
                <th
                  key={idx}
                  className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium text-muted-foreground min-w-[90px] whitespace-nowrap"
                >
                  {MONTHS[idx - 1]}
                </th>
              ))}
              <th className="sticky top-0 z-20 bg-muted text-right px-4 py-3 font-medium text-muted-foreground min-w-[110px] whitespace-nowrap">
                Total
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
                  >
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <button
                        className="flex items-center gap-1.5 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        onClick={() => toggleRow(tipo.id)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                        )}
                        {tipo.nombre}
                      </button>
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
                      className="text-right px-4 py-2.5 tabular-nums cursor-pointer hover:text-primary"
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
                >
                  <td className="sticky left-0 z-10 bg-background px-4 py-2 shadow-[1px_0_0_0_hsl(var(--border))]">
                    <span className="pl-7 block text-left">{cobro.nombre}</span>
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
                    className="text-right px-4 py-2 tabular-nums text-muted-foreground cursor-pointer hover:text-foreground"
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
