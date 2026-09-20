"use client";
import { useMemo, useState } from "react";
import { useResultadosData } from "@/hooks/use-resultados-data";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { ChevronDown, ChevronUp, Inbox, ListTree } from "lucide-react";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { hasValue } from "@/lib/dashboard/pivot-utils";
import { pctSobreIngresos } from "@/lib/dashboard/resultados-calc";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { origenAlcanza } from "@/lib/apertura/validaciones";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PivotLoading, PivotError } from "./pivot-states";
import { KpiBlock } from "./kpi-block";
import { CajaRows } from "./caja-rows";
import { SocietarioRows } from "./societario-rows";
import { SectionDivider } from "./section-divider";
import { StickyCardCell } from "./sticky-card-cell";
import { cardCellClasses, CARD_GAP_HEIGHT } from "@/lib/dashboard/card-row-classes";
import { EditedDot, AperturaDot } from "./edit-row-controls";
import type { PivotRubroRow, PivotConceptoRow } from "@/lib/dashboard/types";
import type { NivelRegla } from "@/lib/apertura/schemas";
import { ComprasDetalleModal } from "./compras-detalle-modal";
import { VentasDetalleModal } from "./ventas-detalle-modal";
import { AperturaGastosModal } from "./apertura-gastos-modal";
import { AperturaSplitButton } from "./apertura-split-button";

export function ResultadosPivotTable() {
  const {
    year, localId, pdvId, months, sortCol, sortDir, handleSortClick,
    operacion, data, isLoading, error, ventasData,
    flatRows, resultadosEmpty,
    expanded, toggleRow, collapseAll, collapseConceptos,
    detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  } = useResultadosData();

  const [apertura, setApertura] = useState<{
    nivel: NivelRegla;
    entidadId: string;
    entidadNombre: string;
    origenLocalId: number | null;
    origenPdvId: number | null;
  } | null>(null);
  const { reglas } = useReglasApertura();
  // Mismo cálculo que pivot-table-por-concepto.tsx — un solo pase sobre las
  // reglas activas alcanzables por el filtro actual, separado por nivel.
  const reglasActivasPorNivel = useMemo(() => {
    const activas = reglas.filter((r) => r.estado === "activa");
    const alcanzaFiltro = (r: (typeof activas)[number]) => {
      if (pdvId == null && localId == null) return true;
      if (pdvId != null) {
        return origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          { localId: localId ?? r.origenLocalId, puntoDeVentaId: pdvId }
        );
      }
      return r.origenLocalId === localId;
    };
    const alcanzadas = activas.filter(alcanzaFiltro);
    return {
      concepto: new Set(alcanzadas.filter((r) => r.nivel === "concepto").map((r) => r.entidadId)),
      registro: new Set(alcanzadas.filter((r) => r.nivel === "registro").map((r) => r.entidadId)),
    };
  }, [reglas, localId, pdvId]);

  if (operacion.isLoading || isLoading) return <PivotLoading />;
  if (operacion.error || error) return <PivotError />;
  if (!operacion.data || !data) return <PivotLoading />;

  const ingresosPorMes = ventasData?.columnTotals ?? {};
  const egresosPorMes = operacion.data.columnTotals;
  const gananciaPorMes = data.columnTotals;
  const colSpan = months.length + 3; // label + meses + total + % ing

  return (
    <>
      {/* El padding vive en este wrapper (sin scroll), no en el div con overflow-auto: position:sticky
          se calcula mal en Chrome cuando el propio contenedor scrolleable tiene padding, y el header/columna
          sticky dejan pasar contenido por detrás tanto en scroll vertical como horizontal. */}
      <div className="flex-1 min-h-0 p-2.5 overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-muted border-b">
                <th className="sticky left-0 top-0 z-30 bg-muted text-left px-4 py-3 font-medium text-muted-foreground min-w-[240px] whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                  Operación
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
                <th className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium text-muted-foreground min-w-[64px] whitespace-nowrap">
                  % ing
                </th>
              </tr>

              <KpiBlock
                months={months}
                ingresosPorMes={ingresosPorMes}
                egresosPorMes={egresosPorMes}
                ingresosTotal={ventasData?.grandTotal}
                egresosTotal={operacion.data.grandTotal}
                ingresosReady={!!ventasData}
                variant="flush-top"
                onIngresoCellClick={(mes) => setVentasDetalleFilter({ year, localId, pdvId, mes })}
                onIngresoTotalClick={() => setVentasDetalleFilter({ year, localId, pdvId })}
              />

              <tr aria-hidden><td colSpan={colSpan} className={CARD_GAP_HEIGHT} /></tr>

              <CajaRows
                year={year}
                localId={localId}
                pdvId={pdvId}
                months={months}
                isEmpty={resultadosEmpty}
              />

              <tr aria-hidden><td colSpan={colSpan} className={CARD_GAP_HEIGHT} /></tr>

              <SocietarioRows
                months={months}
                ingresosPorMes={ingresosPorMes}
                ingresosTotal={ventasData?.grandTotal}
                gananciaPorMes={gananciaPorMes}
                gananciaTotal={data.grandTotal}
                isEmpty={resultadosEmpty}
              />

              <tr aria-hidden><td colSpan={colSpan} className={CARD_GAP_HEIGHT} /></tr>
            </thead>

            <tbody>
              <SectionDivider label="Detalle" icon={ListTree} colSpan={colSpan} topOfCard />
              {flatRows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className={cn("py-12 border-b border-l border-r border-black/[0.08] rounded-b-xl")}>
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Inbox className="w-8 h-8 opacity-40" />
                      <p className="text-sm text-center">
                        No hay conceptos marcados como visibles en Resultados.<br />
                        Usá el ícono de configuración para elegir cuáles mostrar.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                flatRows.map((item, idx) => {
                  const rowPosition = idx === flatRows.length - 1 ? "last" : "middle";

                  if (item.type === "rubro") {
                    const rubro = item.data as PivotRubroRow;
                    const isExpanded = expanded.has(rubro.id);
                    return (
                      <tr
                        key={rubro.id}
                        className="border-b font-semibold"
                        onContextMenu={collapseAll}
                      >
                        <StickyCardCell position={rowPosition} bg="bg-muted" className="px-4 py-2.5">
                          <ExpandableButton isExpanded={isExpanded} onClick={() => toggleRow(rubro.id)}>
                            {rubro.nombre}
                          </ExpandableButton>
                        </StickyCardCell>
                        {months.map((mes) => (
                          <td
                            key={mes}
                            className={cn(
                              "text-right px-3 py-2.5 tabular-nums bg-muted/25 hover:bg-muted/50 transition-colors",
                              cardCellClasses(rowPosition, "mid"),
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
                          className={cn("text-right px-4 py-2.5 tabular-nums font-bold bg-muted/25 hover:bg-muted/50 transition-colors cursor-pointer hover:text-primary", cardCellClasses(rowPosition, "mid"))}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetalle({ rubroCodigo: rubro.rubroCodigo });
                          }}
                        >
                          {fmtARS(rubro.rowTotal)}
                        </td>
                        <td className={cn("text-right px-3 py-2.5 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap bg-muted/25 hover:bg-muted/50 transition-colors", cardCellClasses(rowPosition, "right"))}>
                          {pctSobreIngresos(rubro.rowTotal, ventasData?.grandTotal ?? 0)}
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
                        <StickyCardCell position={rowPosition} className="px-4 py-2">
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
                            <AperturaSplitButton
                              variant="block"
                              puedeAperturar={localId != null && pdvId != null}
                              tieneReglaActiva={reglasActivasPorNivel.concepto.has(concepto.conceptoCodigo)}
                              onClick={() => setApertura({
                                nivel: "concepto",
                                entidadId: concepto.conceptoCodigo,
                                entidadNombre: concepto.nombre,
                                origenLocalId: localId ?? null,
                                origenPdvId: pdvId ?? null,
                              })}
                            />
                          </div>
                        </StickyCardCell>
                        {months.map((mes) => {
                          const comp = concepto.composicion?.[mes];
                          const cell = (
                            <td
                              key={mes}
                              className={cn(
                                "text-right px-3 py-2 tabular-nums text-muted-foreground",
                                cardCellClasses(rowPosition, "mid"),
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
                                <div className="flex flex-col items-start gap-0.5">
                                  <div className="font-medium">100% · {fmtARS(comp.total)}</div>
                                  {comp.destinos.map((d, i) => (
                                    <div key={i} className="text-background/70">
                                      {d.pct}% {d.nombre} {fmtARS(d.importe)}
                                    </div>
                                  ))}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                        <td
                          className={cn("text-right px-4 py-2 tabular-nums text-muted-foreground font-semibold cursor-pointer hover:text-foreground", cardCellClasses(rowPosition, "mid"))}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetalle({ conceptoCodigo: concepto.conceptoCodigo });
                          }}
                        >
                          {fmtARS(concepto.rowTotal)}
                        </td>
                        <td className={cn("text-right px-3 py-2 tabular-nums text-xs text-muted-foreground/50 whitespace-nowrap", cardCellClasses(rowPosition, "right"))}>
                          {pctSobreIngresos(concepto.rowTotal, ventasData?.grandTotal ?? 0)}
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
                  const labelProv = labelParts.join(' · ');
                  return (
                    <tr
                      key={prov.id}
                      className={cn(
                        "group border-b transition-colors",
                        prov.hasManualOverride
                          ? "bg-attention/5 hover:bg-attention/10"
                          : "hover:bg-accent/20"
                      )}
                    >
                      <StickyCardCell position={rowPosition} className={cn("px-4 py-1.5 pl-14 text-xs", prov.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                        <span className="flex items-center gap-1.5">
                          {prov.hasManualOverride && <EditedDot />}
                          {prov.distribucionId != null && <AperturaDot />}
                          {labelProv}
                          <AperturaSplitButton
                            puedeAperturar={localId != null && pdvId != null}
                            tieneReglaActiva={reglasActivasPorNivel.registro.has(prov.rowId)}
                            onClick={() => setApertura({
                              nivel: "registro",
                              entidadId: prov.rowId,
                              entidadNombre: labelProv,
                              origenLocalId: prov.localIdOrigen,
                              origenPdvId: prov.puntoDeVentaIdOrigen,
                            })}
                          />
                        </span>
                      </StickyCardCell>
                      {months.map((mes) => (
                        <td
                          key={mes}
                          className={cn(
                            "text-right px-3 py-1.5 tabular-nums text-muted-foreground text-xs",
                            cardCellClasses(rowPosition, "mid"),
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
                        className={cn("text-right px-4 py-1.5 tabular-nums text-muted-foreground text-xs cursor-pointer hover:text-foreground", cardCellClasses(rowPosition, "mid"))}
                        onClick={() => openDetalle({ rowId: prov.rowId, distribucionId: prov.distribucionId ?? undefined })}
                      >
                        {fmtARS(prov.rowTotal)}
                      </td>
                      <td className={cn("text-right px-3 py-1.5 tabular-nums text-xs text-muted-foreground/40 whitespace-nowrap", cardCellClasses(rowPosition, "right"))}>
                        {pctSobreIngresos(prov.rowTotal, ventasData?.grandTotal ?? 0)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
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
        nivel={apertura?.nivel ?? "concepto"}
        entidadId={apertura?.entidadId ?? null}
        entidadNombre={apertura?.entidadNombre ?? ""}
        origenLocalId={apertura?.origenLocalId ?? null}
        origenPdvId={apertura?.origenPdvId ?? null}
        onClose={() => setApertura(null)}
      />
    </>
  );
}
