"use client";
import { useMemo } from "react";
import { origenAlcanza } from "@/lib/apertura/validaciones";
import type { ReglaAperturaDTO } from "@/lib/apertura/types";

export interface ReglasActivasPorNivel {
  concepto: Set<string>;
  proveedor: Set<string>;
  registro: Set<string>;
}

// Función pura — separada del hook para poder testearla directo con Vitest
// (no hay infraestructura de test de hooks de React en este proyecto).
export function computeReglasActivasPorNivel(
  reglas: ReglaAperturaDTO[],
  localId: number | undefined,
  pdvId: number | undefined
): ReglasActivasPorNivel {
  const activas = reglas.filter((r) => r.estado === "activa");
  const alcanzaFiltro = (r: ReglaAperturaDTO) => {
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
    proveedor: new Set(alcanzadas.filter((r) => r.nivel === "proveedor").map((r) => r.entidadId)),
    registro: new Set(alcanzadas.filter((r) => r.nivel === "registro").map((r) => r.entidadId)),
  };
}

// Un solo pase sobre las reglas activas alcanzables por el filtro actual,
// separado por nivel — extraído tras aparecer duplicado byte a byte (salvo
// el nivel "proveedor") en pivot-table-por-concepto.tsx,
// pivot-table-por-proveedor.tsx y resultados-pivot-table.tsx.
export function useReglasActivasPorNivel(
  reglas: ReglaAperturaDTO[],
  localId: number | undefined,
  pdvId: number | undefined
): ReglasActivasPorNivel {
  return useMemo(
    () => computeReglasActivasPorNivel(reglas, localId, pdvId),
    [reglas, localId, pdvId]
  );
}
