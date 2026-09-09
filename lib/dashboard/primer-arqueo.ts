import { prisma } from "@/lib/prisma";

// El arqueo (Disponible en caja) más viejo cargado que matchea el filtro de local/PDV.
// "Diferencia de caja" solo tiene sentido a partir del mes SIGUIENTE a este (el arqueo es la
// caja inicial del mes que viene — ver spec 2026-08-24 §1). Un $0 es "sin dato", no ancla el
// cálculo (spec 2026-08-31), por eso `monto: { not: 0 }`.
export async function findPrimerArqueo(filtro: {
  localId?: number;
  puntoDeVentaId?: number;
}): Promise<{ anio: number; mes: number } | null> {
  const primera = await prisma.flujoCajaManual.findFirst({
    where: {
      monto: { not: 0 },
      ...(filtro.localId !== undefined ? { localId: filtro.localId } : {}),
      ...(filtro.puntoDeVentaId !== undefined ? { puntoDeVentaId: filtro.puntoDeVentaId } : {}),
    },
    orderBy: [{ anio: "asc" }, { mes: "asc" }],
    select: { anio: true, mes: true },
  });
  return primera ? { anio: primera.anio, mes: primera.mes } : null;
}
