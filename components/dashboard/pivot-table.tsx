"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { MONTHS, MONTH_IDXS } from "@/lib/dashboard/constants";
import { buildDashboardUrl } from "@/lib/dashboard/params";
import type {
  PivotData,
  PivotRubroRow,
  PivotConceptoRow,
  PivotProveedorRow,
  DetalleFilter,
} from "@/lib/dashboard/types";
import { DetalleModal } from "./detalle-modal";

const EPSILON = 0.01; // Umbral: valores < $0.01 se tratan como cero

function hasValue(v: number | undefined): boolean {
  return (v ?? 0) > EPSILON;
}

type FlatRow =
  | { type: "rubro"; data: PivotRubroRow }
  | { type: "concepto"; data: PivotConceptoRow }
  | { type: "proveedor"; data: PivotProveedorRow };

function flattenRows(pivotData: PivotData, expanded: Set<string>): FlatRow[] {
  const result: FlatRow[] = [];
  for (const rubro of pivotData.rows) {
    result.push({ type: "rubro", data: rubro });
    if (!expanded.has(rubro.id)) continue;
    for (const concepto of rubro.children) {
      result.push({ type: "concepto", data: concepto });
      if (!expanded.has(concepto.id)) continue;
      for (const prov of concepto.children) {
        result.push({ type: "proveedor", data: prov });
      }
    }
  }
  return result;
}

export function PivotTable() {
  const searchParams = useSearchParams();
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const localId = searchParams.get("localId")
    ? Number(searchParams.get("localId"))
    : undefined;
  const pdvId = searchParams.get("pdvId")
    ? Number(searchParams.get("pdvId"))
    : undefined;
  const rubroCodigo = searchParams.get("rubroCodigo") ?? undefined;
  const conceptoCodigo = searchParams.get("conceptoCodigo") ?? undefined;
  const proveedorId = searchParams.get("proveedorId")
    ? Number(searchParams.get("proveedorId"))
    : undefined;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detalleFilter, setDetalleFilter] = useState<DetalleFilter | null>(null);
  const prevFilterRef = useRef<{ conceptoCodigo?: string; proveedorId?: number }>({});

  const url = useMemo(
    () =>
      buildDashboardUrl("/api/dashboard/pivot", {
        year,
        localId,
        pdvId,
        rubroCodigo,
        conceptoCodigo,
        proveedorId,
      }),
    [year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId]
  );

  const { data, isLoading, error } = useQuery<PivotData>({
    queryKey: ["pivot", year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Error cargando datos");
      return res.json();
    },
    staleTime: 30_000,
  });

  // Auto-expandir cuando hay filtro de concepto o proveedor; colapsar al quitar filtro.
  // Usa ref para detectar si el filtro cambió vs. un refetch silencioso, evitando
  // pisar el estado manual de colapso cuando TanStack Query revalida en background.
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

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openDetalle(extra: Omit<DetalleFilter, "year" | "localId" | "pdvId">) {
    setDetalleFilter({ year, localId, pdvId, ...extra });
  }

  const flatRows = useMemo(
    () => (data ? flattenRows(data, expanded) : []),
    [data, expanded]
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center h-full">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-muted-foreground/20 border-t-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive py-16 text-center">
        Error al cargar los datos.
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-16 text-center">
        Sin datos para los filtros seleccionados.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="bg-muted border-b">
              <th className="sticky left-0 top-0 z-30 bg-muted text-left px-4 py-3 font-medium text-muted-foreground min-w-[240px] whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                Concepto / Proveedor
              </th>
              {MONTHS.map((m) => (
                <th
                  key={m}
                  className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium text-muted-foreground min-w-[90px] whitespace-nowrap"
                >
                  {m}
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
                const rubro = item.data;
                const isExpanded = expanded.has(rubro.id);
                return (
                  <tr
                    key={rubro.id}
                    className="border-b bg-muted/25 font-semibold hover:bg-muted/50 transition-colors"
                  >
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <button
                        className="flex items-center gap-1.5 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        onClick={() => toggleRow(rubro.id)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                        )}
                        {rubro.nombre}
                      </button>
                    </td>
                    {MONTH_IDXS.map((mes) => (
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
                  </tr>
                );
              }

              if (item.type === "concepto") {
                const concepto = item.data;
                const isExpanded = expanded.has(concepto.id);
                return (
                  <tr
                    key={concepto.id}
                    className="border-b hover:bg-accent/40 transition-colors"
                  >
                    <td className="sticky left-0 z-10 bg-background px-4 py-2 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <button
                        className="flex items-center gap-1.5 pl-5 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        onClick={() => toggleRow(concepto.id)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {concepto.nombre}
                      </button>
                    </td>
                    {MONTH_IDXS.map((mes) => (
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
                  {MONTH_IDXS.map((mes) => (
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
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t-2 bg-muted font-semibold">
              <td className="sticky left-0 z-10 bg-muted px-4 py-3 text-sm shadow-[1px_0_0_0_hsl(var(--border))]">
                Total {year}
              </td>
              {MONTH_IDXS.map((mes) => (
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

      <DetalleModal
        filter={detalleFilter}
        onClose={() => setDetalleFilter(null)}
      />
    </>
  );
}
