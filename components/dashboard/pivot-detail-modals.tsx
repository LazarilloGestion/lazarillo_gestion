"use client";
import { useState } from "react";
import { ComprasDetalleModal } from "./compras-detalle-modal";
import { VentasDetalleModal } from "./ventas-detalle-modal";
import { AperturaGastosModal } from "./apertura-gastos-modal";
import type { NivelRegla } from "@/lib/apertura/schemas";
import type { DetalleFilter, VentasDetalleFilter } from "@/lib/dashboard/types";

// Estado del modal de apertura — idéntico en pivot-table-por-concepto.tsx y
// pivot-table-por-proveedor.tsx antes de esta extracción.
export interface AperturaModalState {
  nivel: NivelRegla;
  entidadId: string;
  entidadNombre: string;
  origenLocalId: number | null;
  origenPdvId: number | null;
}

export function useAperturaModalState() {
  return useState<AperturaModalState | null>(null);
}

interface PivotDetailModalsProps {
  detalleFilter: DetalleFilter | null;
  onCloseDetalle: () => void;
  ventasDetalleFilter: VentasDetalleFilter | null;
  onCloseVentasDetalle: () => void;
  apertura: AperturaModalState | null;
  onCloseApertura: () => void;
}

// Los 3 modales de drill-down/apertura de la tabla pivot de compras — idénticos
// byte a byte entre pivot-table-por-concepto.tsx y pivot-table-por-proveedor.tsx
// antes de esta extracción.
export function PivotDetailModals({
  detalleFilter,
  onCloseDetalle,
  ventasDetalleFilter,
  onCloseVentasDetalle,
  apertura,
  onCloseApertura,
}: PivotDetailModalsProps) {
  return (
    <>
      <ComprasDetalleModal filter={detalleFilter} onClose={onCloseDetalle} />
      <VentasDetalleModal filter={ventasDetalleFilter} onClose={onCloseVentasDetalle} />
      <AperturaGastosModal
        nivel={apertura?.nivel ?? "concepto"}
        entidadId={apertura?.entidadId ?? null}
        entidadNombre={apertura?.entidadNombre ?? ""}
        origenLocalId={apertura?.origenLocalId ?? null}
        origenPdvId={apertura?.origenPdvId ?? null}
        onClose={onCloseApertura}
      />
    </>
  );
}
