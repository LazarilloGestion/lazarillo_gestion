"use client";
import { useState } from "react";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { usePivotScreenDataPorProveedor } from "@/hooks/use-pivot-screen-data-por-proveedor";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { MONTHS, RUBRO_GASTOS_EN_PERSONAL_CODIGO } from "@/lib/dashboard/constants";
import { hasValue } from "@/lib/dashboard/pivot-utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { useReglasActivasPorNivel } from "@/hooks/use-reglas-activas-por-nivel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import { KpiBlock } from "./kpi-block";
import { EditedDot, AperturaDot } from "./edit-row-controls";
import type { PivotDataPorProveedor, PivotRubroRowPorProveedor, PivotProveedorSubRow, PivotConceptoSubRow, ComposicionMes } from "@/lib/dashboard/types";
import { ComprasDetalleModal } from "./compras-detalle-modal";
import { VentasDetalleModal } from "./ventas-detalle-modal";
import { AperturaGastosModal } from "./apertura-gastos-modal";
import { AperturaSplitButton } from "./apertura-split-button";
import type { NivelRegla } from "@/lib/apertura/schemas";
import { candidatosEntidadIdProveedor } from "@/lib/proveedor-entidad-id";

// Envuelve una celda con el tooltip de prorrateo cuando hay composicion para
// esa celda (mes puntual o total anual, de concepto o de proveedor agregado)
// — sin composicion, devuelve la celda tal cual, sin tooltip.
function ComposicionTooltip({ comp, children }: { comp: ComposicionMes | undefined; children: React.ReactElement }) {
  if (!comp) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="text-xs">
        {/* TooltipContent es inline-flex (fila) por defecto — envolver en
            flex-col para que el detalle se lea de arriba a abajo en vez de
            romperse a mitad de palabra cuando hay 2+ destinos. */}
        <div className="flex flex-col items-start gap-0.5">
          <div className="font-medium">100% · {fmtARS(comp.total)}</div>
          {comp.destinos.map((d, i) => (
            <div key={i} className="text-background/70">
              {Math.round(d.pct)}% {d.nombre} {fmtARS(d.importe)}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function PivotTableByProveedor() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion, agrupacionCompras, setAgrupacionCompras,
  } = useDashboard();

  const [pctMode, setPctMode] = useState<"ingresos" | "egresos">("ingresos");
  const [apertura, setApertura] = useState<{
    nivel: NivelRegla;
    entidadId: string;
    entidadNombre: string;
    origenLocalId: number | null;
    origenPdvId: number | null;
  } | null>(null);
  const { reglas } = useReglasApertura();
  // Reemplaza conceptosConReglaActiva (Fase 1) ahora que hay 3 niveles que
  // pueden mostrar el ícono coloreado.
  const reglasActivasPorNivel = useReglasActivasPorNivel(reglas, localId, pdvId);

  const { data, isLoading, error, ventasData, ventasLoading } = useOperacionKpis<PivotDataPorProveedor>({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, configVersion: rubroConfigVersion, agrupacion: "proveedor",
  });

  const {
    expanded, toggleRow, collapseAll, collapseProveedores, collapseConceptos,
    flatRows, detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  } = usePivotScreenDataPorProveedor({
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
  });

  if (isLoading) return <PivotLoading />;
  if (error) return <PivotError />;
  if (!data || data.rows.length === 0) return <PivotEmpty />;

  const pctDenominator = pctMode === "ingresos" ? (ventasData?.grandTotal ?? 0) : data.grandTotal;

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
                <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5 w-fit">
                  <button
                    onClick={() => setAgrupacionCompras("concepto")}
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
                    onClick={() => setAgrupacionCompras("proveedor")}
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
                </div>
              </th>
              {months.map((idx) => (
                <th key={idx} className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium min-w-[90px] whitespace-nowrap">
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
              if (item.type === "rubroTop") {
                const rubro = item.data as PivotRubroRowPorProveedor;
                const isExpanded = expanded.has(rubro.id);
                return (
                  <tr key={rubro.id} className="border-b font-semibold" onContextMenu={collapseAll}>
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

              if (item.type === "proveedorSub") {
                const proveedor = item.data as PivotProveedorSubRow;
                const isExpanded = expanded.has(proveedor.id);
                const filtroProveedor = proveedor.proveedorId != null
                  ? { proveedorId: proveedor.proveedorId }
                  : proveedor.proveedorTexto != null
                    ? { proveedorTexto: proveedor.proveedorTexto, codigo: proveedor.codigo ?? undefined }
                    : { sinProveedor: true as const };
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
                          onClick={() => setApertura({
                            nivel: "proveedor",
                            entidadId: proveedor.entidadIdProveedor,
                            entidadNombre: normalize(proveedor.nombre),
                            origenLocalId: localId ?? null,
                            origenPdvId: pdvId ?? null,
                          })}
                        />
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
                          {fmtARS(proveedor.values[mes])}
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
                              openDetalle({ mes, conceptoCodigo: concepto.conceptoCodigo, ...filtroProveedorConcepto });
                          }}
                        >
                          {fmtARS(concepto.values[mes])}
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
                      {fmtARS(linea.values[mes])}
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

      <ComprasDetalleModal filter={detalleFilter} onClose={() => setDetalleFilter(null)} />
      <VentasDetalleModal filter={ventasDetalleFilter} onClose={() => setVentasDetalleFilter(null)} />

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
