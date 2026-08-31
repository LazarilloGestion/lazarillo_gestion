"use client";
import { useMemo, useState } from "react";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { usePivotScreenData } from "@/hooks/use-pivot-screen-data";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { ChevronDown, ChevronUp, Split } from "lucide-react";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { hasValue } from "@/lib/dashboard/pivot-utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { origenAlcanza } from "@/lib/apertura/validaciones";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import { KpiBlock } from "./kpi-block";
import { EditedDot } from "./edit-row-controls";
import type { PivotRubroRow, PivotConceptoRow } from "@/lib/dashboard/types";
import { ComprasDetalleModal } from "./compras-detalle-modal";
import { VentasDetalleModal } from "./ventas-detalle-modal";
import { AperturaGastosModal } from "./apertura-gastos-modal";


export function PivotTable() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion,
  } = useDashboard();

  const [pctMode, setPctMode] = useState<"ingresos" | "egresos">("ingresos");
  const [aperturaConcepto, setAperturaConcepto] = useState<{ codigo: string; nombre: string } | null>(null);
  const { reglas } = useReglasApertura();
  // Step 2: indicador sensible al filtro local/PDV.
  // Considera solo reglas cuyo origen cae dentro del filtro seleccionado.
  const conceptosConReglaActiva = useMemo(() => {
    const activas = reglas.filter((r) => r.estado === "activa");
    const alcanzaFiltro = (r: (typeof activas)[number]) => {
      if (pdvId == null && localId == null) return true;
      if (pdvId != null) {
        return origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          { localId: localId ?? r.origenLocalId, puntoDeVentaId: pdvId }
        );
      }
      return r.origenLocalId === localId; // solo local seleccionado
    };
    return new Set(activas.filter(alcanzaFiltro).map((r) => r.entidadId));
  }, [reglas, localId, pdvId]);

  const { data, isLoading, error, ventasData, ventasLoading } = useOperacionKpis({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, configVersion: rubroConfigVersion,
  });

  const {
    expanded, toggleRow, collapseAll, collapseConceptos,
    flatRows, detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  } = usePivotScreenData({
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
  });

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

  return (
    <>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <KpiBlock
              months={months}
              ingresosPorMes={ingresosPorMes}
              egresosPorMes={egresosPorMes}
              ingresosTotal={ventasData?.grandTotal}
              egresosTotal={data.grandTotal}
              ingresosReady={!!ventasData}
              variant="borderless"
              onIngresoCellClick={(mes) => setVentasDetalleFilter({ year, localId, pdvId, mes })}
              onIngresoTotalClick={() => setVentasDetalleFilter({ year, localId, pdvId })}
            />
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
              <th className="sticky top-0 z-20 bg-muted text-right px-4 py-3 font-semibold text-[15px] min-w-[110px] whitespace-nowrap">
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
                    className="border-b font-semibold"
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
                          "text-right px-3 py-2.5 tabular-nums bg-muted/25 hover:bg-muted/50 transition-colors",
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
                      className="text-right px-4 py-2.5 tabular-nums font-semibold text-[15px] bg-muted/25 hover:bg-muted/50 transition-colors cursor-pointer hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetalle({ rubroCodigo: rubro.rubroCodigo });
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
                      <div className="flex items-center gap-1">
                        <ExpandableButton
                          isExpanded={isExpanded}
                          onClick={() => toggleRow(concepto.id)}
                          indent="pl-5"
                          iconSize="w-3.5 h-3.5"
                          className="flex-1 min-w-0"
                        >
                          {concepto.nombre}
                        </ExpandableButton>
                        <button
                          type="button"
                          title="Apertura de gastos"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAperturaConcepto({ codigo: concepto.conceptoCodigo, nombre: concepto.nombre });
                          }}
                          className={cn(
                            "shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors",
                            conceptosConReglaActiva.has(concepto.conceptoCodigo)
                              ? "text-primary"
                              : "text-muted-foreground/40 hover:text-muted-foreground"
                          )}
                        >
                          <Split className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    {months.map((mes) => {
                      // Step 3: tooltip de composición cuando hay reglas aplicadas a este concepto/mes.
                      const comp = concepto.composicion?.[mes];
                      const cell = (
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
                      );
                      if (!comp) return cell;
                      return (
                        <Tooltip key={mes}>
                          <TooltipTrigger asChild>{cell}</TooltipTrigger>
                          <TooltipContent className="text-xs">
                            <div className="font-medium">100% · {fmtARS(comp.total)}</div>
                            {comp.destinos.map((d, i) => (
                              <div key={i} className="text-background/70">
                                {d.pct}% {d.nombre} {fmtARS(d.importe)}
                              </div>
                            ))}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                    <td
                      className="text-right px-4 py-2 tabular-nums text-muted-foreground font-semibold text-sm cursor-pointer hover:text-foreground"
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
              const labelParts = [
                prov.fecha ? `${prov.fecha.slice(8, 10)}/${prov.fecha.slice(5, 7)}` : null,
                normalize(prov.nombre),
                prov.observac || null,
                fmtARS(prov.importe),
              ].filter(Boolean);
              return (
                <tr
                  key={prov.id}
                  className={cn(
                    "border-b transition-colors",
                    prov.hasManualOverride
                      ? "bg-attention/5 hover:bg-attention/10"
                      : "hover:bg-accent/20"
                  )}
                >
                  <td className={cn("sticky left-0 z-10 bg-background px-4 py-1.5 pl-14 text-xs shadow-[1px_0_0_0_hsl(var(--border))]", prov.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5">
                      {prov.hasManualOverride && <EditedDot />}
                      {labelParts.join(' · ')}
                    </span>
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
                          openDetalle({ rowId: prov.rowId, distribucionId: prov.distribucionId ?? undefined });
                      }}
                    >
                      {fmtARS(prov.values[mes])}
                    </td>
                  ))}
                  <td
                    className="text-right px-4 py-1.5 tabular-nums text-muted-foreground text-xs cursor-pointer hover:text-foreground"
                    onClick={() => openDetalle({ rowId: prov.rowId, distribucionId: prov.distribucionId ?? undefined })}
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
            <tr className="border-t-2 bg-muted font-semibold text-[15px]">
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
              <td className="text-right px-3 py-3 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap font-semibold bg-muted">
                {pctMode === "egresos" ? "—" : fmtPct(data.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ComprasDetalleModal
        filter={detalleFilter}
        onClose={() => setDetalleFilter(null)}
      />
      <VentasDetalleModal
        filter={ventasDetalleFilter}
        onClose={() => setVentasDetalleFilter(null)}
      />

      <AperturaGastosModal
        conceptoCodigo={aperturaConcepto?.codigo ?? null}
        conceptoNombre={aperturaConcepto?.nombre ?? ""}
        onClose={() => setAperturaConcepto(null)}
      />

    </>
  );
}
