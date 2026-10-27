import type { Prisma } from "@prisma/client";

// Alta de concepto con "padrino" (Diego, 26/10/2026): el nuevo concepto copia
// las reglas de apertura ACTIVAS del padrino (nivel concepto), con el mismo
// origen, vigencia y destinos. El concepto nuevo no tiene compras todavía, así
// que no hay nada que redistribuir: las reglas aplican a lo que se cargue.
export type ReglaPadrino = {
  origenLocalId: number | null;
  origenPuntoDeVentaId: number | null;
  modo: string;
  fechaDesde: Date | null;
  fechaHasta: Date | null;
  extremosInclusivos: boolean;
  destinos: { localId: number | null; puntoDeVentaId: number | null; porcentaje: Prisma.Decimal | number | string }[];
};

export function reglasCopiadas(reglas: ReglaPadrino[], codigoNuevo: string, creadoPor: string | null): Prisma.ReglaAperturaCreateInput[] {
  return reglas.map((r) => ({
    nivel: "concepto",
    entidadId: codigoNuevo,
    ...(r.origenLocalId != null ? { origenLocal: { connect: { id: r.origenLocalId } } } : {}),
    ...(r.origenPuntoDeVentaId != null ? { origenPuntoDeVenta: { connect: { id: r.origenPuntoDeVentaId } } } : {}),
    modo: r.modo,
    fechaDesde: r.fechaDesde,
    fechaHasta: r.fechaHasta,
    extremosInclusivos: r.extremosInclusivos,
    creadoPor,
    destinos: {
      create: r.destinos.map((d) => ({
        ...(d.localId != null ? { local: { connect: { id: d.localId } } } : {}),
        ...(d.puntoDeVentaId != null ? { puntoDeVenta: { connect: { id: d.puntoDeVentaId } } } : {}),
        porcentaje: d.porcentaje,
      })),
    },
  }));
}
