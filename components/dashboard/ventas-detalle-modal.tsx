"use client";
import { CalendarDays, Building2, Tag, Layers, ArrowDownUp, Users } from "lucide-react";
import { fmtARS, fmtDate, normalize } from "@/lib/utils";
import { buildVentasDetalleUrl } from "@/lib/dashboard/params";
import type { VentasDetalleFilter, VentaDetalle } from "@/lib/dashboard/types";
import { DetalleModalBase, type ColDef } from "./detalle-modal";

const VENTAS_COLS: ColDef[] = [
  { label: "Fecha",       icon: CalendarDays, color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Local",       icon: Building2,    color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Tipo",        icon: Layers,       color: "text-blue-500",         bg: "bg-blue-500/10",    right: false },
  { label: "Cobro",       icon: Tag,          color: "text-violet-500",       bg: "bg-violet-500/10",  right: false },
  { label: "Turno",       icon: Users,        color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Comprobante", icon: Tag,          color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Mesa",        icon: Tag,          color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Mozo",        icon: Users,        color: "text-muted-foreground", bg: "bg-muted",          right: false },
  { label: "Importe",     icon: ArrowDownUp,  color: "text-muted-foreground", bg: "bg-muted",          right: true  },
];

function renderVentasRow(v: VentaDetalle): React.ReactNode[] {
  return [
    fmtDate(v.fecha),
    normalize(v.local?.nombre),
    normalize(v.tipo),
    normalize(v.cobro),
    normalize(v.turno),
    normalize(v.comprobant),
    normalize(v.mesa),
    normalize(v.mozo),
    fmtARS(v.importe != null ? Number(v.importe) : null),
  ];
}

export function VentasDetalleModal({ filter, onClose }: { filter: VentasDetalleFilter | null; onClose: () => void }) {
  return (
    <DetalleModalBase<VentaDetalle>
      title="Detalle de ventas"
      filter={filter}
      buildUrl={(f) => buildVentasDetalleUrl(f as VentasDetalleFilter)}
      queryKey={["detalle-ventas", filter]}
      cols={VENTAS_COLS}
      renderRow={renderVentasRow}
      onClose={onClose}
    />
  );
}
