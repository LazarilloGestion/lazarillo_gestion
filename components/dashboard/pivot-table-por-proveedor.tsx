"use client";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { usePivotScreenDataPorProveedor } from "@/hooks/use-pivot-screen-data-por-proveedor";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { RUBRO_GASTOS_EN_PERSONAL_CODIGO } from "@/lib/dashboard/constants";
import { hasValue } from "@/lib/dashboard/pivot-utils";
import { filtroFilaProveedor } from "@/lib/dashboard/filtro-fila-proveedor";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useCargaDesdeCelda } from "@/hooks/use-carga-desde-celda";
import { mesAnteriorConValor } from "@/lib/dashboard/carga-desde-celda";
import { MONTHS } from "@/lib/dashboard/constants";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { useReglasActivasPorNivel } from "@/hooks/use-reglas-activas-por-nivel";
import { usePctMode, makeFmtCelda } from "@/hooks/use-pct-mode";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import { PivotTableHead } from "./pivot-table-head";
import { PivotTableFoot } from "./pivot-table-foot";
import { RubroRow } from "./pivot-rubro-row";
import { ComposicionTooltip } from "./composicion-tooltip";
import { PivotDetailModals, useAperturaModalState } from "./pivot-detail-modals";
import { EditedDot, AperturaDot } from "./edit-row-controls";
import type { PivotDataPorProveedor, PivotRubroRowPorProveedor, PivotProveedorSubRow, PivotConceptoSubRow } from "@/lib/dashboard/types";
import { AperturaSplitButton } from "./apertura-split-button";
import { ConceptoFijoEmpleado, useConceptosEmpleado } from "@/components/empleados/concepto-fijo";
import { candidatosEntidadIdProveedor } from "@/lib/proveedor-entidad-id";

export function PivotTableByProveedor() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, importeQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion, agrupacionCompras, setAgrupacionCompras, modoCelda, setModoCelda,
  } = useDashboard();
  // Mes vacío de un concepto → cargar el gasto vario de ese mes (Diego 29/10). Solo en Económica
  // (el mes es el período) y con local + PDV elegidos (la carga va a ese PDV).
  const { modoPanel } = useDashboard();
  const pedirCarga = useCargaDesdeCelda((x) => x.pedir);
  const cargaEnCelda = modoPanel !== "financiera" && localId != null && pdvId != null;

  const [apertura, setApertura] = useAperturaModalState();
  const { data: conceptosFijos } = useConceptosEmpleado(pdvId);
  const { reglas } = useReglasApertura();
  // Reemplaza conceptosConReglaActiva (Fase 1) ahora que hay 3 niveles que
  // pueden mostrar el ícono coloreado.
  const reglasActivasPorNivel = useReglasActivasPorNivel(reglas, localId, pdvId);

  const { data, isLoading, error, ventasData, ventasLoading } = useOperacionKpis<PivotDataPorProveedor>({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, importeQuery,
    months, activeMonths, configVersion: rubroConfigVersion, agrupacion: "proveedor",
  });

  const {
    expanded, toggleRow, collapseAll, collapseProveedores, collapseConceptos,
    flatRows, detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  } = usePivotScreenDataPorProveedor({
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery, importeQuery,
    rubroCodigo, activeMonths,
  });

  // Ver la misma nota en pivot-table-por-concepto.tsx: usePctMode es un hook
  // (useState interno), tiene que ejecutarse antes de cualquier return
  // condicional.
  const { pctMode, togglePctMode, fmtPct } = usePctMode(
    data?.grandTotal ?? 0,
    ventasData?.grandTotal,
    ventasLoading
  );

  if (isLoading) return <PivotLoading />;
  if (error) return <PivotError />;
  if (!data || data.rows.length === 0) return <PivotEmpty />;

  const ingresosPorMes = ventasData?.columnTotals ?? {};
  const fmtCelda = makeFmtCelda(modoCelda, ingresosPorMes, !!ventasData);
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
            modoCelda={modoCelda}
            onModoCeldaChange={setModoCelda}
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
              if (item.type === "rubroTop") {
                const rubro = item.data as PivotRubroRowPorProveedor;
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
                    fmtCelda={fmtCelda}
                  />
                );
              }

              if (item.type === "proveedorSub") {
                const proveedor = item.data as PivotProveedorSubRow;
                const isExpanded = expanded.has(proveedor.id);
                const filtroProveedor = filtroFilaProveedor(proveedor);
                // Bajo Gastos En Personal los "proveedores" suelen ser personas de
                // planilla con nombres ambiguos — el código del ERP los desambigua.
                // En el resto de rubros el nombre ya alcanza, así que no se antepone.
                const nombreProveedor =
                  proveedor.rubroCodigo === RUBRO_GASTOS_EN_PERSONAL_CODIGO && proveedor.codigo
                    ? `${proveedor.codigo} - ${normalize(proveedor.nombre)}`
                    : normalize(proveedor.nombre);
                return (
                  <tr key={proveedor.id} className="border-b font-semibold" onContextMenu={collapseProveedores}>
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <div className="flex items-center gap-1">
                        <ExpandableButton
                          isExpanded={isExpanded}
                          onClick={() => toggleRow(proveedor.id)}
                          indent="pl-5"
                          iconSize="w-3.5 h-3.5"
                          className="flex-1 min-w-0"
                        >
                          {nombreProveedor}
                        </ExpandableButton>
                        <AperturaSplitButton
                          variant="block"
                          puedeAperturar={localId != null && pdvId != null}
                          tieneReglaActiva={candidatosEntidadIdProveedor(proveedor.entidadIdProveedor).some((c) => reglasActivasPorNivel.proveedor.has(c))}
                          reglaVencida={candidatosEntidadIdProveedor(proveedor.entidadIdProveedor).some((c) => reglasActivasPorNivel.vencidas.proveedor.has(c))}
                          onClick={() => setApertura({
                            nivel: "proveedor",
                            entidadId: proveedor.entidadIdProveedor,
                            entidadNombre: normalize(proveedor.nombre),
                            origenLocalId: localId ?? null,
                            origenPdvId: pdvId ?? null,
                          })}
                        />
                        {/* Concepto fijo del empleado (personas de planilla: texto del ERP con código). */}
                        {proveedor.proveedorId == null && proveedor.codigo && proveedor.entidadIdProveedor.startsWith("texto:") && (
                          <ConceptoFijoEmpleado pdvId={pdvId} entidadId={proveedor.entidadIdProveedor} nombre={normalize(proveedor.nombre)} reglas={conceptosFijos?.reglas ?? []} />
                        )}
                      </div>
                    </td>
                    {months.map((mes) => (
                      <ComposicionTooltip key={mes} comp={proveedor.composicion?.[mes]}>
                        <td
                          className={cn(
                            "text-right px-3 py-2.5 tabular-nums bg-muted/25 hover:bg-muted/50 transition-colors",
                            hasValue(proveedor.values[mes]) && "cursor-pointer hover:text-primary"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasValue(proveedor.values[mes]))
                              openDetalle({ mes, ...filtroProveedor });
                          }}
                        >
                          {fmtCelda(proveedor.values[mes], mes)}
                        </td>
                      </ComposicionTooltip>
                    ))}
                    <ComposicionTooltip comp={proveedor.composicionTotal}>
                      <td
                        className="text-right px-4 py-2.5 tabular-nums font-semibold text-[15px] bg-muted/25 hover:bg-muted/50 transition-colors cursor-pointer hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetalle(filtroProveedor);
                        }}
                      >
                        {fmtARS(proveedor.rowTotal)}
                      </td>
                    </ComposicionTooltip>
                    <td className="text-right px-3 py-2.5 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap bg-muted/25 hover:bg-muted/50 transition-colors">
                      {fmtPct(proveedor.rowTotal)}
                    </td>
                  </tr>
                );
              }

              if (item.type === "conceptoSub") {
                const concepto = item.data as PivotConceptoSubRow;
                const isExpanded = expanded.has(concepto.id);
                const filtroProveedorConcepto = concepto.proveedorId != null
                  ? { proveedorId: concepto.proveedorId }
                  : concepto.proveedorTexto != null
                    ? { proveedorTexto: concepto.proveedorTexto, codigo: concepto.codigo ?? undefined }
                    : { sinProveedor: true as const };
                return (
                  <tr key={concepto.id} className="border-b hover:bg-accent/40 transition-colors" onContextMenu={collapseConceptos}>
                    <td className="sticky left-0 z-10 bg-background px-4 py-2 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <div className="flex items-center gap-1">
                        <ExpandableButton
                          isExpanded={isExpanded}
                          onClick={() => toggleRow(concepto.id)}
                          indent="pl-9"
                          iconSize="w-3 h-3"
                          className="flex-1 min-w-0"
                        >
                          {concepto.nombre}
                        </ExpandableButton>
                        <AperturaSplitButton
                          variant="block"
                          puedeAperturar={localId != null && pdvId != null}
                          tieneReglaActiva={reglasActivasPorNivel.concepto.has(concepto.conceptoCodigo)}
                          reglaVencida={reglasActivasPorNivel.vencidas.concepto.has(concepto.conceptoCodigo)}
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
                            hasValue(concepto.values[mes]) && "cursor-pointer hover:text-foreground",
                            !hasValue(concepto.values[mes]) && cargaEnCelda && concepto.proveedorId == null && "cursor-copy hover:bg-sky-50 dark:hover:bg-sky-950/40"
                          )}
                          title={!hasValue(concepto.values[mes]) && cargaEnCelda && concepto.proveedorId == null ? `Cargar ${concepto.nombre} en ${MONTHS[mes - 1]} como gasto vario` : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasValue(concepto.values[mes]))
                              openDetalle({ mes, conceptoCodigo: concepto.conceptoCodigo, ...filtroProveedorConcepto });
                            else if (cargaEnCelda && concepto.proveedorId == null)
                              pedirCarga({ anio: year, mes, conceptoCodigo: concepto.conceptoCodigo, conceptoNombre: concepto.nombre, prev: mesAnteriorConValor(concepto.values, mes),
                                filtroPrev: { conceptoCodigo: concepto.conceptoCodigo, ...filtroProveedorConcepto } });
                          }}
                        >
                          {fmtCelda(concepto.values[mes], mes)}
                        </td>
                      </ComposicionTooltip>
                    ))}
                    <ComposicionTooltip comp={concepto.composicionTotal}>
                      <td
                        className="text-right px-4 py-2 tabular-nums text-muted-foreground font-semibold text-sm cursor-pointer hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetalle({ conceptoCodigo: concepto.conceptoCodigo, ...filtroProveedorConcepto });
                        }}
                      >
                        {fmtARS(concepto.rowTotal)}
                      </td>
                    </ComposicionTooltip>
                    <td className="text-right px-3 py-2 tabular-nums text-xs text-muted-foreground/50 whitespace-nowrap">
                      {fmtPct(concepto.rowTotal)}
                    </td>
                  </tr>
                );
              }

              const linea = item.data;
              const labelParts = [
                linea.fecha ? `${linea.fecha.slice(8, 10)}/${linea.fecha.slice(5, 7)}` : null,
                linea.observac || null,
                fmtARS(linea.importe),
              ].filter(Boolean);
              const labelLinea = labelParts.join(' · ');
              const tieneReglaRegistro = reglasActivasPorNivel.registro.has(linea.rowId);
              return (
                <tr
                  key={linea.id}
                  className={cn(
                    "group border-b transition-colors",
                    linea.hasManualOverride ? "bg-attention/5 hover:bg-attention/10" : "hover:bg-accent/20"
                  )}
                >
                  <td className={cn("sticky left-0 z-10 bg-background px-4 py-1.5 pl-[4.5rem] text-xs shadow-[1px_0_0_0_hsl(var(--border))]", linea.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5">
                      {linea.hasManualOverride && <EditedDot />}
                      {linea.distribucionId != null && <AperturaDot />}
                      {labelLinea}
                      <AperturaSplitButton
                        puedeAperturar={localId != null && pdvId != null}
                        tieneReglaActiva={tieneReglaRegistro}
                        onClick={() => setApertura({
                          nivel: "registro",
                          entidadId: linea.rowId,
                          entidadNombre: labelLinea,
                          origenLocalId: linea.localIdOrigen,
                          origenPdvId: linea.puntoDeVentaIdOrigen,
                        })}
                      />
                    </span>
                  </td>
                  {months.map((mes) => (
                    <td
                      key={mes}
                      className={cn(
                        "text-right px-3 py-1.5 tabular-nums text-muted-foreground text-xs",
                        hasValue(linea.values[mes]) && "cursor-pointer hover:text-foreground"
                      )}
                      onClick={() => {
                        if (hasValue(linea.values[mes]))
                          openDetalle({ rowId: linea.rowId, distribucionId: linea.distribucionId ?? undefined });
                      }}
                    >
                      {fmtCelda(linea.values[mes], mes)}
                    </td>
                  ))}
                  <td
                    className="text-right px-4 py-1.5 tabular-nums text-muted-foreground text-xs cursor-pointer hover:text-foreground"
                    onClick={() => openDetalle({ rowId: linea.rowId, distribucionId: linea.distribucionId ?? undefined })}
                  >
                    {fmtARS(linea.rowTotal)}
                  </td>
                  <td className="text-right px-3 py-1.5 tabular-nums text-xs text-muted-foreground/40 whitespace-nowrap">
                    {fmtPct(linea.rowTotal)}
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
            fmtCelda={fmtCelda}
            onMonthClick={(mes) => openDetalle({ mes })}
            onTotalClick={() => openDetalle({})}
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
