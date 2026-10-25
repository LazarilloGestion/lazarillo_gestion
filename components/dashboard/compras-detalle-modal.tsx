"use client";
import { useState, useMemo, useCallback } from "react";
import { notify } from "@/lib/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Truck, Tag, Layers, ArrowDownUp, FileText, MessageSquare } from "lucide-react";
import type { NivelRegla } from "@/lib/apertura/schemas";
import { AperturaGastosModal, type RegistroLote } from "./apertura-gastos-modal";
import { cambiosLote, describirCambios, type CamposLote, type CuerpoLote } from "@/lib/dashboard/edicion-lote";
import { AperturaSplitButton } from "./apertura-split-button";
import { MoverPdvButton } from "./mover-pdv-button";
import { cuerpoMover, filasAMover, type DestinoMover } from "@/lib/apertura/mover";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn, fmtARS, fmtDate, normalize } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { buildComprasDetalleUrl } from "@/lib/dashboard/params";
import { resolverImporteParaPatch } from "@/lib/dashboard/importe-para-patch";
import { SIN_RUBRO_CODE, SIN_RUBRO_NOMBRE } from "@/lib/dashboard/constants";
import type { DetalleFilter, DetalleResponse, CompraDetalle } from "@/lib/dashboard/types";
import type { SortState } from "@/hooks/use-sort-state";
import {
  EditActionButtons, EditTriggerButton, EditedDot, toEditString,
} from "./edit-row-controls";
import { CompraLineasModal } from "./compra-lineas-modal";
import { DetalleModalShell } from "./detalle-modal-shell";
import { DetallePeriodoControls } from "./detalle-periodo-controls";
import { periodoInicial, aplicarPeriodo, labelPeriodo, type Periodo } from "@/lib/dashboard/detalle-periodo";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import type { Local } from "@/lib/types/domain";
import { CtaCteContenido, CtaCteModal, origenDeFila, type OrigenCtaCte } from "@/components/cta-cte/cta-cte-proveedor";
import { ETIQUETA_ESTADO, PUNTO_ESTADO } from "@/lib/cta-cte/estado";

export interface ColDef {
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  right: boolean;
  sortKey?: string;
  /** Clave del filtro por columna (ver DetalleModalShell.columnFields). */
  filterKey?: string;
  /** Ancho reservado (clase Tailwind). La tabla es table-fixed: las columnas
   *  sin ancho se reparten el resto y se comprimen con puntos suspensivos. */
  width?: string;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ConceptoOption = { codigo: string; nombre: string; rubroNombre: string; rubroCodigo: string | null };

type RubroOption = { codigo: string; nombre: string };

type EditState = {
  rowId: string;
  // Una compra distribuida se abre en N filas de fan-out con el mismo rowId
  // (v_compras_distribuidas) — distribucionId desambigua cuál fila está en
  // edición para que el formulario no aparezca en las N a la vez.
  distribucionId: number | null;
  // La fila de fan-out solo trae su porción del importe (importeCalculado del
  // destino): el input de importe se precarga con el total de la compra base
  // (`importeBase`), y el guardado solo lo manda si cambió respecto de
  // `importeInicial` (ver resolverImporteParaPatch).
  esDistribuida: boolean;
  importeManual: string;
  importeInicial: string;
  fechaManual: string;
  conceptoCodigoManual: string;
  observacManual: string;
  rubroFiltro: string; // solo filtra el combo de conceptos, nunca se guarda
  // Valores al abrir el formulario: con filas tildadas, solo lo que cambió
  // respecto de esto se aplica a las demás (ver lib/dashboard/edicion-lote).
  inicial: CamposLote;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isEdited(c: CompraDetalle) {
  return c.importeManual != null || c.fechaManual != null || c.conceptoCodigoManual != null || c.observacManual != null;
}

function toDateInputValue(iso: string | null | undefined): string {
  return iso?.slice(0, 10) ?? "";
}

// Mismo criterio de armado que `labelProv`/`labelLinea` en las tablas de pivot
// (fecha · proveedor · observación · importe) — para que el título de la
// regla de apertura se lea igual sin importar desde qué vista se abrió.
function buildEntidadNombre(item: CompraDetalle): string {
  const parts = [
    fmtDate(item.fechaManual ?? item.fecha),
    normalize(item.proveedor ?? item.proveedorRef?.nombre ?? item.proveedorRef?.razon),
    item.observacManual ?? item.observac ?? null,
    fmtARS(item.importeManual != null ? Number(item.importeManual) : item.importe != null ? Number(item.importe) : null),
  ];
  return parts.filter(Boolean).join(" · ");
}

// ─── RubroSelect ──────────────────────────────────────────────────────────────

function RubroSelect({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: RubroOption[];
}) {
  return (
    <Select value={value || SIN_RUBRO_CODE} onValueChange={onValueChange}>
      <SelectTrigger className="h-7 w-full text-xs" size="sm">
        <SelectValue placeholder="Rubro" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.codigo} value={o.codigo} className="text-xs">
            {o.nombre}
          </SelectItem>
        ))}
        <SelectItem value={SIN_RUBRO_CODE} className="text-xs text-muted-foreground">
          {SIN_RUBRO_NOMBRE}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

// ─── ConceptoCombobox ─────────────────────────────────────────────────────────

function ConceptoCombobox({
  value,
  onValueChange,
  options,
  portalContainer,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: ConceptoOption[];
  portalContainer: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.codigo === value);
  return (
    <div className="contents">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-xs hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <span className="truncate">{selected?.nombre ?? <span className="text-muted-foreground">Sin cambio</span>}</span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" container={portalContainer}>
          <Command>
            <CommandInput placeholder="Buscar concepto..." className="h-8 text-xs" />
            <CommandList className="max-h-52">
              <CommandEmpty className="py-2 text-center text-xs text-muted-foreground">Sin resultados.</CommandEmpty>
              {options.map((opt) => (
                <CommandItem
                  key={opt.codigo}
                  value={`${opt.codigo} ${opt.nombre}`}
                  onSelect={() => { onValueChange(opt.codigo); setOpen(false); }}
                  className="text-xs"
                >
                  <Check className={cn("mr-1 h-3 w-3", value === opt.codigo ? "opacity-100" : "opacity-0")} />
                  {opt.nombre}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Column definitions ───────────────────────────────────────────────────────

// Columnas angostas y Observación con todo el resto (Diego, 25/10: "no leo",
// la quería 3-4 veces más ancha). En edición los controles ocupan el ancho
// de su celda (w-full), así que achicar una columna no los desborda.
// Anchos en % (table-fixed): Fecha/Local/Importe fijos y angostos; el resto se
// reparte lo que queda y se comprime con puntos suspensivos + tooltip.
const COMPRAS_COLS: ColDef[] = [
  // Sin columna Local (va en el subtítulo del modal) y sin filtro por columna:
  // anchos fijos y angostos para todo menos Observación, que se lleva el resto.
  { label: "Fecha",       icon: CalendarDays,   color: "text-muted-foreground",   bg: "bg-muted",                right: false, sortKey: "fecha",       width: "w-[7rem]"    },
  { label: "Proveedor",   icon: Truck,          color: "text-cat-proveedor",      bg: "bg-cat-proveedor/12",     right: false, sortKey: "proveedor",   width: "w-[9rem]"    },
  { label: "Detalle",     icon: FileText,       color: "text-muted-foreground",   bg: "bg-muted",                right: false, sortKey: "detalle",     width: "w-[6rem]"    },
  { label: "Observación", icon: MessageSquare,  color: "text-cat-observacion",    bg: "bg-cat-observacion/12",   right: false, sortKey: "observacion"                       },
  { label: "Rubro",       icon: Layers,         color: "text-cat-rubro",          bg: "bg-cat-rubro/12",         right: false,                         width: "w-[8.5rem]"  },
  { label: "Concepto",    icon: Tag,            color: "text-cat-concepto",       bg: "bg-cat-concepto/12",      right: false, sortKey: "concepto",    width: "w-[9rem]"    },
  { label: "Importe",     icon: ArrowDownUp,    color: "text-muted-foreground",   bg: "bg-muted",                right: true,  sortKey: "importe",     width: "w-[8rem]"    },
];

// ─── Sort ─────────────────────────────────────────────────────────────────────

function sortCompras(a: CompraDetalle, b: CompraDetalle, sort: SortState): number {
  if (!sort) return 0;
  if (sort.key === "importe") {
    const va = Number(a.importeManual ?? a.importe ?? 0);
    const vb = Number(b.importeManual ?? b.importe ?? 0);
    return sort.dir === "asc" ? va - vb : vb - va;
  }
  let va = "", vb = "";
  if (sort.key === "fecha") {
    va = String(a.fechaManual ?? a.fecha ?? "").slice(0, 10);
    vb = String(b.fechaManual ?? b.fecha ?? "").slice(0, 10);
  } else if (sort.key === "proveedor") {
    va = String(a.proveedor || a.proveedorRef?.nombre || a.proveedorRef?.razon || "");
    vb = String(b.proveedor || b.proveedorRef?.nombre || b.proveedorRef?.razon || "");
  } else if (sort.key === "concepto") {
    va = String((a.conceptoCajaManual ?? a.conceptoCaja)?.nombre ?? "");
    vb = String((b.conceptoCajaManual ?? b.conceptoCaja)?.nombre ?? "");
  } else if (sort.key === "detalle") {
    va = String(a.detalle ?? "");
    vb = String(b.detalle ?? "");
  } else if (sort.key === "observacion") {
    va = String(a.observacManual ?? a.observac ?? "");
    vb = String(b.observacManual ?? b.observac ?? "");
  }
  const cmp = va.localeCompare(vb, "es", { numeric: true });
  return sort.dir === "asc" ? cmp : -cmp;
}

// Cuenta corriente de la fila: proveedor del maestro (por código) o, si no lo
// tiene (empleado, gastos varios), por PDV + código + nombre del ERP.
const origenDeFilaDetalle = (item: CompraDetalle) => origenDeFila({
  codigo: item.codigoProveedor, pdvId: item.pdvCompraId, nombre: item.proveedor, tieneMaestro: !!item.proveedorRef,
});

// ─── Row component ────────────────────────────────────────────────────────────

function ComprasRow({
  item,
  editing,
  conceptoOptions,
  rubroOptions,
  portalContainer,
  onEdit,
  onSave,
  onCancel,
  saving,
  onOpenLineas,
  onOpenApertura,
  onOpenCtaCte,
  tieneReglaApertura,
  puedeAperturar,
  seleccion,
  mover,
}: {
  item: CompraDetalle;
  editing: EditState | null;
  conceptoOptions: ConceptoOption[];
  rubroOptions: RubroOption[];
  portalContainer: HTMLElement | null;
  onEdit: (state: EditState) => void;
  onSave: (state: EditState) => void;
  onCancel: () => void;
  onOpenApertura: (item: CompraDetalle) => void;
  // Cuenta corriente del proveedor (null si la fila no tiene proveedor del ERP).
  onOpenCtaCte: ((item: CompraDetalle) => void) | null;
  tieneReglaApertura: boolean;
  // Mismo criterio que en las tablas de pivot: sin local y PDV seleccionados
  // en el filtro del dashboard no se puede resolver un origen para la regla
  // (origen a nivel local completo se sacó de uso, sesión 19-sep-2026).
  puedeAperturar: boolean;
  saving: boolean;
  onOpenLineas: (rowId: string, detalle: string | null) => void;
  // Selección múltiple: checkbox como primera celda (null = sin selección en este modo).
  seleccion: { tildado: boolean; onToggle: () => void } | null;
  // Ícono ⇄ "Mover a otro PDV" (null = no se puede mover esta fila).
  mover: React.ReactNode;
}) {
  const isEditing = editing?.rowId === item.rowId && editing.distribucionId === item.distribucionId;
  const effectiveFecha = item.fechaManual ?? item.fecha;
  const effectiveImporte = item.importeManual ?? item.importe;
  const effectiveConcepto = item.conceptoCajaManual ?? item.conceptoCaja;

  const rubroFiltro = editing?.rubroFiltro;
  const filteredConceptoOptions = useMemo(() => {
    if (!isEditing) return conceptoOptions;
    return rubroFiltro === SIN_RUBRO_CODE
      ? conceptoOptions.filter(o => !o.rubroCodigo)
      : conceptoOptions.filter(o => o.rubroCodigo === rubroFiltro);
  }, [conceptoOptions, isEditing, rubroFiltro]);

  if (isEditing) {
    return (
      <tr className="border-b border-border/40 last:border-0 bg-muted/20">
        {seleccion && (
          <td className="pl-3 py-1.5">
            <input
              type="checkbox"
              aria-label="Tildar registro"
              className="size-3.5 accent-zinc-900 dark:accent-white align-middle cursor-pointer"
              checked={seleccion.tildado}
              onChange={seleccion.onToggle}
            />
          </td>
        )}
        <td className="px-1.5 py-1.5">
          <Input
            type="date"
            className="h-7 text-xs w-full px-1.5"
            value={editing!.fechaManual}
            onChange={e => onEdit({ ...editing!, fechaManual: e.target.value })}
          />
        </td>
        <td className="px-3 py-1.5 truncate text-muted-foreground">
          {normalize(item.proveedor ?? item.proveedorRef?.nombre ?? item.proveedorRef?.razon)}
        </td>
        <td className="px-3 py-1.5 truncate text-muted-foreground">
          {normalize(item.detalle)}
        </td>
        <td className="px-1.5 py-1.5">
          <Input
            type="text"
            className="h-7 text-xs w-full"
            placeholder={normalize(item.observac) ?? ""}
            value={editing!.observacManual}
            onChange={e => onEdit({ ...editing!, observacManual: e.target.value })}
          />
        </td>
        <td className="px-1.5 py-1.5">
          <RubroSelect
            value={editing!.rubroFiltro}
            options={rubroOptions}
            onValueChange={(newRubro) => {
              const stillValid = conceptoOptions.some(
                o => o.codigo === editing!.conceptoCodigoManual &&
                  (newRubro === SIN_RUBRO_CODE ? !o.rubroCodigo : o.rubroCodigo === newRubro)
              );
              onEdit({
                ...editing!,
                rubroFiltro: newRubro,
                conceptoCodigoManual: stillValid ? editing!.conceptoCodigoManual : "",
              });
            }}
          />
        </td>
        <td className="px-1.5 py-1.5">
          <ConceptoCombobox
            value={editing!.conceptoCodigoManual}
            onValueChange={v => onEdit({ ...editing!, conceptoCodigoManual: v })}
            options={filteredConceptoOptions}
            portalContainer={portalContainer}
          />
        </td>
        <td className="px-1.5 py-1.5 text-right">
          <Input
            type="text"
            inputMode="decimal"
            className="h-7 text-xs w-full text-right"
            value={editing!.importeManual}
            onChange={e => onEdit({ ...editing!, importeManual: e.target.value })}
          />
        </td>
        <td className="px-2 py-1.5">
          <EditActionButtons onSave={() => onSave(editing!)} onCancel={onCancel} saving={saving} />
        </td>
      </tr>
    );
  }

  return (
    <tr className={cn("group border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors", seleccion?.tildado && "bg-sky-50 dark:bg-sky-950/30")}>
      {seleccion && (
        <td className="pl-3 py-1.5">
          <input
            type="checkbox"
            aria-label="Tildar registro"
            className="size-3.5 accent-zinc-900 dark:accent-white align-middle cursor-pointer"
            checked={seleccion.tildado}
            onChange={seleccion.onToggle}
          />
        </td>
      )}
      <td className="px-3 py-1.5 truncate">
        <span className="flex items-center gap-1.5">
          {isEdited(item) && <EditedDot />}
          {fmtDate(effectiveFecha)}
        </span>
      </td>
      <td className="px-3 py-1.5 truncate" title={normalize(item.proveedor ?? item.proveedorRef?.nombre ?? item.proveedorRef?.razon)}>
        {onOpenCtaCte ? (
          <button
            type="button"
            onClick={() => onOpenCtaCte(item)}
            title="Ver cuenta corriente"
            className="max-w-full truncate text-left text-sky-700 dark:text-sky-400 underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {normalize(item.proveedor ?? item.proveedorRef?.nombre ?? item.proveedorRef?.razon)}
          </button>
        ) : normalize(item.proveedor ?? item.proveedorRef?.nombre ?? item.proveedorRef?.razon)}
      </td>
      <td className="px-3 py-1.5 truncate" title={item.detalle ?? undefined}>
        {!item.detalle ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          // item.rowId es siempre el de la compra base (nunca un compuesto),
          // así que ver líneas funciona igual para una fila distribuida —
          // muestra el detalle original de la factura, no el de aperturar.
          <button
            onClick={() => onOpenLineas(item.rowId, item.detalle)}
            className="max-w-full truncate text-muted-foreground hover:text-foreground hover:underline font-mono text-xs whitespace-nowrap"
          >
            {item.detalle}
          </button>
        )}
      </td>
      <td className="px-3 py-1.5 truncate text-muted-foreground" title={normalize(item.observacManual ?? item.observac)}>{normalize(item.observacManual ?? item.observac)}</td>
      <td className="px-3 py-1.5 truncate" title={normalize(effectiveConcepto?.rubro?.nombre)}>{normalize(effectiveConcepto?.rubro?.nombre)}</td>
      <td className="px-3 py-1.5 truncate" title={normalize(effectiveConcepto?.nombre)}>{normalize(effectiveConcepto?.nombre)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums font-medium whitespace-nowrap">
        {fmtARS(effectiveImporte != null ? Number(effectiveImporte) : null)}
        {/* Semáforo a la DERECHA del importe (así los importes no se desalinean):
            siempre ocupa su lugar, aunque la fila no tenga estado. */}
        {item.estadoPago ? (
          <button
            type="button"
            disabled={!onOpenCtaCte}
            onClick={() => onOpenCtaCte?.(item)}
            title={`${ETIQUETA_ESTADO[item.estadoPago.estado]}${item.estadoPago.pagado ? ` · pagado ${fmtARS(item.estadoPago.pagado)} de ${fmtARS(item.estadoPago.total)}` : ""}${onOpenCtaCte ? " · ver cuenta corriente" : ""}`}
            aria-label={`Estado: ${ETIQUETA_ESTADO[item.estadoPago.estado]}`}
            className="ml-1.5 inline-flex h-4 w-3 items-center justify-center align-middle"
          >
            <span className={cn("inline-block size-2 rounded-full", PUNTO_ESTADO[item.estadoPago.estado])} />
          </button>
        ) : (
          <span className="ml-1.5 inline-block w-3" />
        )}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          {/* La edición ya está habilitada también para compras distribuidas: el
              PATCH apunta siempre a la compra base (item.rowId) y dispara la
              reevaluación de apertura. El importe queda bloqueado en el
              formulario (se reparte por regla), el resto de los campos sí se
              editan. "Ver líneas" también está habilitado para distribuidas
              (ver columna Detalle) — muestra el detalle original, de solo
              lectura, sin tocar la apertura. */}
          <EditTriggerButton
            onClick={() => {
              const esDistribuida = item.esDistribuido || item.distribucionId != null;
              const importeInicial = toEditString(
                esDistribuida ? item.importeBase : item.importeManual ?? item.importe
              );
              const initialConcepto = item.conceptoCodigoManual ?? item.conceptoCaja?.codigo ?? "";
              const initialRubro = conceptoOptions.find(o => o.codigo === initialConcepto)?.rubroCodigo ?? SIN_RUBRO_CODE;
              onEdit({
                rowId: String(item.rowId),
                distribucionId: item.distribucionId,
                esDistribuida,
                // En una fila de fan-out `item.importe` es solo la porción del
                // destino: se prellena con el total de la compra base.
                importeManual: importeInicial,
                importeInicial,
                fechaManual: toDateInputValue(item.fechaManual ?? item.fecha),
                conceptoCodigoManual: initialConcepto,
                observacManual: item.observacManual ?? "",
                rubroFiltro: initialRubro,
                inicial: {
                  fecha: toDateInputValue(item.fechaManual ?? item.fecha),
                  concepto: initialConcepto,
                  observac: item.observacManual ?? "",
                },
              });
            }}
          />
          {/* Aperturar este registro puntual — mismo modal/nivel "registro" que
              el ícono equivalente de las tablas de pivot (commits 473cd13,
              41bdce7), agregado acá para poder prorratear un gasto individual
              sin salir de "Detalle de compras" durante la depuración de datos. */}
          <AperturaSplitButton
            puedeAperturar={puedeAperturar}
            tieneReglaActiva={tieneReglaApertura}
            onClick={() => onOpenApertura(item)}
          />
          {mover}
        </div>
      </td>
    </tr>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

// Distingue "el PATCH respondió con un error accionable" (ej. un 4xx del
// servidor con mensaje) de cualquier otro fallo (red, refetch) — solo el
// primero muestra su mensaje real al usuario, ver guardarConfirmado.
class GuardError extends Error {}

export function ComprasDetalleModal({ filter, onClose }: { filter: DetalleFilter | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { localId, pdvId } = useDashboard();
  const { reglas: reglasApertura } = useReglasApertura();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedLineas, setSelectedLineas] = useState<{ rowId: string; detalle: string | null } | null>(null);
  // Guardado pendiente de confirmación del usuario: la edición dispara un
  // recálculo de apertura (compra distribuida o concepto nuevo con regla
  // activa) y se le pide OK antes de mandar el PATCH.
  const [pendienteConfirmacion, setPendienteConfirmacion] = useState<EditState | null>(null);
  const [ctaCte, setCtaCte] = useState<{ origen: OrigenCtaCte; resaltado: { pdvId: number; comprobante: string } | null } | null>(null);
  const abrirCtaCte = useCallback((item: CompraDetalle) => {
    const origen = origenDeFilaDetalle(item);
    if (origen) {
      setCtaCte({ origen, resaltado: item.comprobante && item.pdvCompraId != null ? { pdvId: item.pdvCompraId, comprobante: item.comprobante } : null });
    }
  }, []);
  const [apertura, setApertura] = useState<{
    nivel: NivelRegla;
    entidadId: string;
    entidadNombre: string;
    origenLocalId: number | null;
    origenPdvId: number | null;
    lote: RegistroLote[] | null;
  } | null>(null);

  const reglasActivasRegistro = useMemo(
    () => new Set(reglasApertura.filter((r) => r.estado === "activa" && r.nivel === "registro").map((r) => r.entidadId)),
    [reglasApertura]
  );

  // Retain last non-null filter so queryKey (and cached data) stay stable during close animation
  const [stableFilter, setStableFilter] = useState(filter);
  // Período elegido adentro del modal (‹ Julio 2026 › / Mes-Año-Histórico), por
  // encima del que trajo el click. Se reinicia con cada apertura nueva.
  const [periodo, setPeriodo] = useState<Periodo | null>(filter ? periodoInicial(filter) : null);
  if (filter !== null && filter !== stableFilter) {
    setStableFilter(filter);
    setPeriodo(periodoInicial(filter));
  }
  // Un registro puntual (rowId) no tiene período que navegar.
  const conPeriodo = stableFilter != null && !stableFilter.rowId && periodo != null;
  const filtroEfectivo = useMemo(
    () => (stableFilter && conPeriodo && periodo ? aplicarPeriodo(stableFilter, periodo) : stableFilter),
    [stableFilter, conPeriodo, periodo]
  );

  // En Año / Histórico la consulta tiene tope de registros: el buscador también
  // filtra en el servidor para no perder lo que quedó afuera del tope.
  const buscaEnServidor = conPeriodo && periodo != null && periodo.modo !== "mes";
  const [qServidor, setQServidor] = useState("");
  const q = buscaEnServidor ? qServidor : "";
  const resetKey = useMemo(() => ["detalle", filtroEfectivo], [filtroEfectivo]);
  const queryKey = useMemo(() => ["detalle", filtroEfectivo, q], [filtroEfectivo, q]);

  const queryFn = useCallback(async (): Promise<DetalleResponse<CompraDetalle>> => {
    const url = buildComprasDetalleUrl(filtroEfectivo!);
    const res = await fetch(q ? `${url}&q=${encodeURIComponent(q)}` : url);
    if (!res.ok) throw new Error("Error cargando detalle");
    return res.json();
  }, [filtroEfectivo, q]);

  const { data: suggestions } = useQuery<Array<{ type: string; value: string; label: string; rubroNombre?: string; rubroCodigo?: string }>>({
    queryKey: ["suggestions"],
    queryFn: () => fetch("/api/search/suggestions").then((r) => r.json()),
    staleTime: 5 * 60_000,
    enabled: filter !== null,
  });

  const conceptoOptions = useMemo<ConceptoOption[]>(
    () => (suggestions ?? [])
      .filter((s) => s.type === "concepto")
      .map((s) => ({ codigo: s.value, nombre: s.label, rubroNombre: s.rubroNombre ?? "", rubroCodigo: s.rubroCodigo ?? null })),
    [suggestions]
  );

  const rubroOptions = useMemo<RubroOption[]>(
    () => (suggestions ?? [])
      .filter((s) => s.type === "rubro")
      .map((s) => ({ codigo: s.value, nombre: s.label })),
    [suggestions]
  );

  // ── Selección múltiple (punto 1, Diego 24/10): Map rowId → fila. Va antes del
  // guardado porque ✎ sobre una fila tildada aplica el cambio a todas.
  const [tildadas, setTildadas] = useState<Map<string, CompraDetalle>>(() => new Map());
  // Las otras tildadas (sin la que se edita) y lo que se les aplica.
  const loteDeEdicion = useCallback((state: EditState): { otras: CompraDetalle[]; cuerpo: CuerpoLote } | null => {
    if (!tildadas.has(state.rowId) || tildadas.size < 2) return null;
    const cuerpo = cambiosLote(state.inicial, {
      fecha: state.fechaManual,
      concepto: state.conceptoCodigoManual,
      observac: state.observacManual,
    });
    if (Object.keys(cuerpo).length === 0) return null;
    return { otras: [...tildadas.values()].filter((f) => f.rowId !== state.rowId), cuerpo };
  }, [tildadas]);

  const guardarConfirmado = useCallback(async (state: EditState) => {
    const importeResult = resolverImporteParaPatch({
      esDistribuida: state.esDistribuida,
      importeInput: state.importeManual,
      importeInicial: state.importeInicial,
    });
    if (!importeResult.ok) {
      setSaveError("El importe ingresado no es un número válido.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const requestBody = {
        ...(importeResult.incluir ? { importeManual: importeResult.value } : {}),
        fechaManual:          state.fechaManual !== "" ? new Date(state.fechaManual + "T12:00:00Z").toISOString() : null,
        conceptoCodigoManual: state.conceptoCodigoManual !== "" ? state.conceptoCodigoManual : null,
        observacManual:       state.observacManual !== "" ? state.observacManual : null,
      };
      const res = await fetch(`/api/dashboard/compras/${state.rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const resBody = await res.json().catch(() => null);
        throw new GuardError(resBody?.error ?? "Error al guardar");
      }
    } catch (err) {
      // Solo un error del PATCH mismo (ej. el guard 409 de compra distribuida)
      // trae un mensaje accionable del servidor — un fallo de red antes de
      // llegar a la respuesta usa el texto genérico en vez del error técnico
      // crudo (revisión final de rama, ronda 2, hallazgo Minor).
      const message = err instanceof GuardError ? err.message : "No se pudo guardar. Intentá de nuevo.";
      setSaveError(message);
      notify.errorGuardar();
      setSaving(false);
      return;
    }

    // Lote: lo que cambió (fecha/concepto/observación, nunca el importe) va a
    // las otras tildadas, una por una (cada PATCH reevalúa su apertura).
    const lote = loteDeEdicion(state);
    let fallidasLote = 0;
    if (lote) {
      for (const f of lote.otras) {
        try {
          const res = await fetch(`/api/dashboard/compras/${f.rowId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(lote.cuerpo),
          });
          if (!res.ok) fallidasLote++;
        } catch {
          fallidasLote++;
        }
      }
    }

    // El PATCH ya guardó en este punto — un fallo del refetch posterior no es
    // "no se guardó" (los datos ya están persistidos del lado del servidor),
    // así que no lo tratamos como error de guardado.
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey }),
        queryClient.refetchQueries({ queryKey: ["pivot"] }),
        // La reevaluación de apertura puede haber creado/revertido
        // distribuciones — el badge de "regla activa" y la línea de tiempo
        // leen de ["apertura-reglas"].
        queryClient.invalidateQueries({ queryKey: ["apertura-reglas"] }),
      ]);
    } catch (err) {
      console.error("[compras-detalle-modal] guardado OK pero falló el refetch posterior", err);
    }
    setEditing(null);
    if (lote) {
      const total = lote.otras.length + 1;
      setTildadas(new Map());
      if (fallidasLote) toast.warning(`${total - fallidasLote} de ${total} registros actualizados`, { description: `${fallidasLote} no se pudo guardar` });
      else toast.success(`${total} registros actualizados`);
    } else {
      notify.registroActualizado();
    }
    setSaving(false);
  }, [queryClient, queryKey, loteDeEdicion]);

  // Decide si el guardado necesita confirmación: compra distribuida (se
  // recalcula el reparto) o concepto nuevo con una regla de apertura activa
  // (el guardado va a distribuir la compra).
  const handleSave = useCallback((state: EditState) => {
    const conceptoNuevo = state.conceptoCodigoManual;
    const requiereConfirmacion =
      loteDeEdicion(state) !== null ||
      state.esDistribuida ||
      (!!conceptoNuevo && reglasApertura.some((r) => r.estado === "activa" && r.nivel === "concepto" && r.entidadId === conceptoNuevo));
    if (requiereConfirmacion) {
      setPendienteConfirmacion(state);
    } else {
      void guardarConfirmado(state);
    }
  }, [reglasApertura, guardarConfirmado, loteDeEdicion]);

  // Subtítulo: Local · PDV del filtro (la columna Local se sacó de la tabla).
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");

  // ── Selección múltiple + mover a otro PDV (punto 1, Diego 24/10) ──
  // Map rowId → fila: una compra distribuida aparece N veces con el mismo rowId
  // y se tilda/mueve una sola vez. Se limpia al cambiar el filtro o cerrar.
  const [resetPrevio, setResetPrevio] = useState(resetKey);
  if (resetPrevio !== resetKey) {
    setResetPrevio(resetKey);
    setTildadas(new Map());
  }
  const conSeleccion = !filter?.rowId;
  const cambiarTildadas = useCallback((items: CompraDetalle[], tildar: boolean) => {
    setTildadas((prev) => {
      const n = new Map(prev);
      for (const it of items) {
        if (tildar) n.set(it.rowId, it);
        else n.delete(it.rowId);
      }
      return n;
    });
  }, []);

  const moverFilas = useCallback(async (filas: CompraDetalle[], destino: DestinoMover) => {
    const aMover = filasAMover(filas, destino);
    let movidas = 0;
    let conRegla = 0;
    let fallidas = 0;
    for (const f of aMover) {
      try {
        const res = await fetch("/api/apertura/reglas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpoMover(f, destino)),
        });
        if (res.ok) movidas++;
        else if (res.status === 409) conRegla++;
        else fallidas++;
      } catch {
        fallidas++;
      }
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["apertura-reglas"] }),
      queryClient.invalidateQueries({ queryKey: ["apertura-preview-total"] }),
      queryClient.invalidateQueries({ queryKey: ["pivot"] }),
      queryClient.invalidateQueries({ queryKey: ["detalle"] }),
    ]);
    setTildadas(new Map());
    const yaEstaban = filas.length - aMover.length;
    const detalle = [
      conRegla ? `${conRegla} ya tenía${conRegla !== 1 ? "n" : ""} una apertura propia (editala desde ⅄)` : null,
      yaEstaban ? `${yaEstaban} ya estaba${yaEstaban !== 1 ? "n" : ""} en ${destino.etiqueta}` : null,
      fallidas ? `${fallidas} no se pudo mover` : null,
    ].filter(Boolean).join(" · ");
    if (movidas > 0 && !conRegla && !fallidas) toast.success(`${movidas} registro${movidas !== 1 ? "s" : ""} movido${movidas !== 1 ? "s" : ""} a ${destino.etiqueta}`, detalle ? { description: detalle } : undefined);
    else if (movidas > 0) toast.warning(`${movidas} movido${movidas !== 1 ? "s" : ""} a ${destino.etiqueta}`, { description: detalle });
    else toast.error(`No se movió ningún registro`, { description: detalle || undefined });
  }, [queryClient]);
  const subtitulo = useMemo(() => {
    const lid = filter?.localId ?? localId;
    const pid = filter?.pdvId ?? pdvId;
    const l = locales?.find((x) => x.id === lid);
    if (!l) return null;
    const p = l.puntosDeVenta.find((x) => x.id === pid);
    return p ? `${l.nombre} · ${p.nombre}` : l.nombre;
  }, [locales, filter?.localId, filter?.pdvId, localId, pdvId]);

  const searchFields = useCallback((item: CompraDetalle) => [
    item.proveedor,
    item.proveedorRef?.nombre,
    item.proveedorRef?.razon,
    item.observacManual,
    item.observac,
    item.detalle,
    item.concepto,
    (item.conceptoCajaManual ?? item.conceptoCaja)?.nombre,
    (item.conceptoCajaManual ?? item.conceptoCaja)?.rubro?.nombre,
    item.local?.nombre,
  ], []);

  const handleClose = useCallback(() => {
    setEditing(null);
    setSelectedLineas(null);
    setTildadas(new Map());
    onClose();
  }, [onClose]);

  return (
    <>
      <DetalleModalShell<CompraDetalle>
        open={filter !== null}
        onClose={handleClose}
        title="Detalle de compras"
        cols={COMPRAS_COLS}
        queryKey={queryKey}
        queryFn={queryFn}
        resetKey={resetKey}
        onServerQuery={buscaEnServidor ? setQServidor : undefined}
        searchFields={searchFields}
        subtitle={subtitulo}
        sortFn={sortCompras}
        seleccion={conSeleccion ? {
          ids: new Set(tildadas.keys()),
          idDe: (r) => r.rowId,
          onCambiar: cambiarTildadas,
          onLimpiar: () => setTildadas(new Map()),
        } : undefined}
        anchoAcciones="w-[5rem]"
        saveError={saveError}
        isEditing={editing !== null}
        headerControls={conPeriodo && periodo ? <DetallePeriodoControls periodo={periodo} onChange={setPeriodo} /> : null}
        periodoLabel={conPeriodo && periodo ? labelPeriodo(periodo) : null}
        // La tabla muestra la fracción de esta fila, pero el input corrige el
        // total de la compra: al guardar se reparte de nuevo entre destinos.
        // Va en el pie y no bajo el input para no agrandar la fila.
        footerNote={
          editing && tildadas.has(editing.rowId) && tildadas.size > 1
            ? `Fecha, concepto y observación se aplican a los ${tildadas.size} tildados; el importe, solo a este`
            : editing?.esDistribuida ? "El importe es el total de la compra, se reparte según la regla" : null
        }
        // Un registro puntual (click en un gasto de la vista económica): la
        // edición queda arriba, tal cual, y abajo la cuenta corriente del proveedor.
        extra={filter?.rowId ? (rows) => {
          const r = rows[0];
          const origen = r ? origenDeFilaDetalle(r) : null;
          return r && origen
            ? <CtaCteContenido key={`${origen.codPro}|${origen.nombre ?? ""}`} origen={origen} resaltado={r.comprobante && r.pdvCompraId != null ? { pdvId: r.pdvCompraId, comprobante: r.comprobante } : null} />
            : <p className="py-8 text-center text-sm text-muted-foreground">Este gasto no tiene proveedor: no hay cuenta corriente para mostrar.</p>;
        } : undefined}
        renderRow={(item, portalContainer) => (
          // distribucionId ?? rowId: una compra distribuida en N destinos
          // genera N objetos CompraDetalle con el mismo rowId (fan-out de
          // v_compras_distribuidas) — sin esto, React ve keys duplicadas.
          // Ahora que la edición también está habilitada para distribuidas,
          // isEditing compara rowId + distribucionId (ver ComprasRow) para que
          // el formulario aparezca solo en la fila que el usuario abrió, no en
          // las N que comparten rowId.
          <ComprasRow
            key={item.distribucionId != null ? `d-${item.distribucionId}` : item.rowId}
            item={item}
            editing={editing}
            conceptoOptions={conceptoOptions}
            rubroOptions={rubroOptions}
            portalContainer={portalContainer}
            onEdit={setEditing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
            saving={saving}
            onOpenLineas={(rowId, detalle) => setSelectedLineas({ rowId, detalle })}
            onOpenApertura={(row) => {
              // Con la fila tildada (y 2+ tildadas) la regla nueva va para todas.
              const filas = tildadas.has(row.rowId) && tildadas.size > 1 ? [...tildadas.values()] : null;
              setApertura({
                nivel: "registro",
                entidadId: row.rowId,
                entidadNombre: buildEntidadNombre(row),
                origenLocalId: row.localIdOrigen,
                origenPdvId: row.puntoDeVentaIdOrigen,
                lote: filas?.map((f) => ({
                  entidadId: f.rowId,
                  origenLocalId: f.localIdOrigen,
                  origenPdvId: f.puntoDeVentaIdOrigen,
                  importe: Number(f.importeBase ?? f.importeManual ?? f.importe ?? 0),
                })) ?? null,
              });
            }}
            // Con un registro puntual la cuenta corriente ya está abajo.
            onOpenCtaCte={!filter?.rowId && origenDeFilaDetalle(item) ? abrirCtaCte : null}
            tieneReglaApertura={reglasActivasRegistro.has(item.rowId)}
            puedeAperturar={localId != null && pdvId != null}
            seleccion={conSeleccion ? {
              tildado: tildadas.has(item.rowId),
              onToggle: () => cambiarTildadas([item], !tildadas.has(item.rowId)),
            } : null}
            mover={item.puntoDeVentaIdOrigen != null && locales ? (() => {
              // Con la fila tildada actúa sobre todas las tildadas; si no, solo sobre ella.
              const filas = tildadas.has(item.rowId) ? [...tildadas.values()] : [item];
              const importe = filas.reduce((acc, f) => acc + Number(f.importeBase ?? f.importeManual ?? f.importe ?? 0), 0);
              return (
                <MoverPdvButton
                  filas={filas}
                  importeTotal={importe}
                  locales={locales}
                  portalContainer={portalContainer}
                  onMover={moverFilas}
                />
              );
            })() : null}
          />
        )}
      />
      {ctaCte && (
        <CtaCteModal origen={ctaCte.origen} resaltado={ctaCte.resaltado} onCerrar={() => setCtaCte(null)} />
      )}
      <CompraLineasModal
        compraId={selectedLineas?.rowId ?? null}
        comprobante={selectedLineas?.detalle ?? null}
        onClose={() => setSelectedLineas(null)}
      />
      <AperturaGastosModal
        nivel={apertura?.nivel ?? "registro"}
        entidadId={apertura?.entidadId ?? null}
        entidadNombre={apertura?.entidadNombre ?? ""}
        origenLocalId={apertura?.origenLocalId ?? null}
        origenPdvId={apertura?.origenPdvId ?? null}
        lote={apertura?.lote ?? null}
        onLoteGuardado={() => setTildadas(new Map())}
        onClose={() => setApertura(null)}
      />
      <ConfirmDialog
        open={pendienteConfirmacion !== null}
        // Cancelar solo cierra el diálogo: la fila queda en edición y no se
        // manda ningún PATCH.
        onOpenChange={(open) => { if (!open) setPendienteConfirmacion(null); }}
        title={pendienteConfirmacion && loteDeEdicion(pendienteConfirmacion) ? "Aplicar a los registros tildados" : "Recalcular apertura de gastos"}
        description={(() => {
          const lote = pendienteConfirmacion ? loteDeEdicion(pendienteConfirmacion) : null;
          return lote
            ? `Se cambia ${describirCambios(lote.cuerpo)} en los ${lote.otras.length + 1} registros tildados (el importe solo en este). Si alguno tiene apertura, se recalcula. ¿Confirmás?`
            : "Esto va a recalcular la apertura de este registro según las reglas de apertura vigentes. ¿Confirmás?";
        })()}
        confirmLabel="Confirmar y guardar"
        confirming={saving}
        onConfirm={() => {
          const state = pendienteConfirmacion;
          setPendienteConfirmacion(null);
          if (state) void guardarConfirmado(state);
        }}
      />
    </>
  );
}
