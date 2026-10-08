"use client";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { usePivotScreenData } from "@/hooks/use-pivot-screen-data";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { hasValue } from "@/lib/dashboard/pivot-utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { useReglasActivasPorNivel } from "@/hooks/use-reglas-activas-por-nivel";
import { usePctMode } from "@/hooks/use-pct-mode";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import { PivotTableHead } from "./pivot-table-head";
import { PivotTableFoot } from "./pivot-table-foot";
import { RubroRow } from "./pivot-rubro-row";
import { ComposicionTooltip } from "./composicion-tooltip";
import { PivotDetailModals, useAperturaModalState } from "./pivot-detail-modals";
import { EditedDot, AperturaDot } from "./edit-row-controls";
import type { PivotRubroRow, PivotConceptoRow } from "@/lib/dashboard/types";
import { AperturaSplitButton } from "./apertura-split-button";

export function PivotTableByConcepto() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion, agrupacionCompras, setAgrupacionCompras,
  } = useDashboard();

  const [apertura, setApertura] = useAperturaModalState();
  const { reglas } = useReglasApertura();
  // Este árbol solo necesita concepto y registro (no proveedor: acá no hay
  // una fila de proveedor donde mostrar ese ícono, ver PivotTableByProveedor
  // para el nivel proveedor).
  const reglasActivasPorNivel = useReglasActivasPorNivel(reglas, localId, pdvId);

  const { data, isLoading, error, ventasData, ventasLoading } = useOperacionKpis({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, configVersion: rubroConfigVersion,
  });

  const {
    expanded, toggleRow, collapseAll, collapseConceptos,
    flatRows, detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  } = usePivotScreenData({
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
    rubroCodigo, activeMonths,
  });

  // usePctMode llama a useState internamente — tiene que ejecutarse antes de
  // cualquier return condicional (reglas de hooks). data?.grandTotal ?? 0 es
  // un fallback seguro para el instante antes de que `data` cargue: el
  // return de <PivotLoading /> de abajo hace que ese valor nunca se llegue
  // a renderizar.
  const { pctMode, togglePctMode, fmtPct } = usePctMode(
    data?.grandTotal ?? 0,
    ventasData?.grandTotal,
    ventasLoading
  );

  if (isLoading) return <PivotLoading />;
  if (error) return <PivotError />;
  if (!data || data.rows.length === 0) return <PivotEmpty />;

  const ingresosPorMes = ventasData?.columnTotals ?? {};
  const egresosPorMes = data.columnTotals;

  return (
    <>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm border-separate border-spacing-0">
          <PivotTableHead
            months={months}
            sortCol={sortCol}
            sortDir={sortDir}
            onSortClick={handleSortClick}
            agrupacionCompras={agrupacionCompras}
            onAgrupacionChange={setAgrupacionCompras}
            pctMode={pctMode}
            onTogglePctMode={togglePctMode}
            ingresosPorMes={ingresosPorMes}
            egresosPorMes={egresosPorMes}
            ingresosTotal={ventasData?.grandTotal}
            egresosTotal={data.grandTotal}
            ingresosReady={!!ventasData}
            onIngresoCellClick={(mes) => setVentasDetalleFilter({ year, localId, pdvId, mes })}
            onIngresoTotalClick={() => setVentasDetalleFilter({ year, localId, pdvId })}
          />

          <tbody>
            {flatRows.map((item) => {
              if (item.type === "rubro") {
                const rubro = item.data as PivotRubroRow;
                return (
                  <RubroRow
                    key={rubro.id}
                    rubro={rubro}
                    months={months}
                    isExpanded={expanded.has(rubro.id)}
                    onToggle={() => toggleRow(rubro.id)}
                    onCollapseAll={collapseAll}
                    onCellClick={(mes, rubroCodigo) => openDetalle({ mes, rubroCodigo })}
                    onTotalClick={(rubroCodigo) => openDetalle({ rubroCodigo })}
                    fmtPct={fmtPct}
                  />
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
                    </td>
                    {months.map((mes) => (
                      <ComposicionTooltip key={mes} comp={concepto.composicion?.[mes]}>
                        <td
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
                      </ComposicionTooltip>
                    ))}
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
              const labelProv = labelParts.join(' · ');
              const tieneReglaRegistro = reglasActivasPorNivel.registro.has(prov.rowId);
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
                  <td className={cn("sticky left-0 z-10 bg-background px-4 py-1.5 pl-14 text-xs shadow-[1px_0_0_0_hsl(var(--border))]", prov.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5">
                      {prov.hasManualOverride && <EditedDot />}
                      {prov.distribucionId != null && <AperturaDot />}
                      {labelProv}
                      <AperturaSplitButton
                        puedeAperturar={localId != null && pdvId != null}
                        tieneReglaActiva={tieneReglaRegistro}
                        onClick={() => setApertura({
                          nivel: "registro",
                          entidadId: prov.rowId,
                          entidadNombre: labelProv,
                          origenLocalId: prov.localIdOrigen,
                          origenPdvId: prov.puntoDeVentaIdOrigen,
                        })}
                      />
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

          <PivotTableFoot
            year={year}
            months={months}
            columnTotals={data.columnTotals}
            grandTotal={data.grandTotal}
            pctMode={pctMode}
            fmtPct={fmtPct}
          />
        </table>
      </div>

      <PivotDetailModals
        detalleFilter={detalleFilter}
        onCloseDetalle={() => setDetalleFilter(null)}
        ventasDetalleFilter={ventasDetalleFilter}
        onCloseVentasDetalle={() => setVentasDetalleFilter(null)}
        apertura={apertura}
        onCloseApertura={() => setApertura(null)}
      />
    </>
  );
}
