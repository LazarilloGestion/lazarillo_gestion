"use client";
import { useMemo } from "react";
import { origenAlcanza } from "@/lib/apertura/validaciones";
import { estadoVigenciaRegla, hoyUTC } from "@/lib/apertura/estado-vigencia";
import type { ReglaAperturaDTO } from "@/lib/apertura/types";

export interface ReglasActivasPorNivel {
  // Entidades con al menos una regla VIGENTE hoy (estado activa + ventana de
  // vigencia que cubre hoy) alcanzable por el filtro local/PDV. Hasta
  // oct-2026 solo miraba el flag `estado`, así que una regla vencida seguía
  // pintando el ícono de apertura como "con regla" (caso real Vanesa Judit).
  concepto: Set<string>;
  proveedor: Set<string>;
  registro: Set<string>;
  // Entidades que tienen reglas activas alcanzables pero NINGUNA vigente
  // porque todas vencieron (no cuenta "próxima"): los gastos nuevos de esa
  // entidad ya no se aperturan. Las tablas pintan el ícono en rojo.
  vencidas: {
    concepto: Set<string>;
    proveedor: Set<string>;
    registro: Set<string>;
  };
}

// Función pura — separada del hook para poder testearla directo con Vitest
// (no hay infraestructura de test de hooks de React en este proyecto).
export function computeReglasActivasPorNivel(
  reglas: ReglaAperturaDTO[],
  localId: number | undefined,
  pdvId: number | undefined,
  hoy: Date = hoyUTC()
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
  const vigentes = alcanzadas.filter((r) => estadoVigenciaRegla(r, hoy) === "vigente");
  const soloVencidas = alcanzadas.filter((r) => estadoVigenciaRegla(r, hoy) === "vencida");

  const porNivel = (lista: ReglaAperturaDTO[], nivel: ReglaAperturaDTO["nivel"]) =>
    new Set(lista.filter((r) => r.nivel === nivel).map((r) => r.entidadId));

  const concepto = porNivel(vigentes, "concepto");
  const proveedor = porNivel(vigentes, "proveedor");
  const registro = porNivel(vigentes, "registro");
  // Vencida solo si la entidad no tiene, además, alguna vigente.
  const sinVigente = (s: Set<string>, vig: Set<string>) => new Set([...s].filter((id) => !vig.has(id)));

  return {
    concepto,
    proveedor,
    registro,
    vencidas: {
      concepto: sinVigente(porNivel(soloVencidas, "concepto"), concepto),
      proveedor: sinVigente(porNivel(soloVencidas, "proveedor"), proveedor),
      registro: sinVigente(porNivel(soloVencidas, "registro"), registro),
    },
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
