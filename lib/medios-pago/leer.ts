import { prisma } from "@/lib/prisma";
import type { MedioPago, TipoMedio } from "./abm";

// Solo servidor.
// Lista del gestor con cuántos pagos usa cada medio.
export async function leerMedios(): Promise<MedioPago[]> {
  const [medios, usos, usosProv] = await Promise.all([
    prisma.medioPago.findMany({ orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
    prisma.pagoInterno.groupBy({ by: ["medio"], _count: { _all: true } }),
    prisma.pagoProveedor.groupBy({ by: ["medio"], _count: { _all: true } }),
  ]);
  const cuenta = new Map<string, number>();
  for (const u of [...usos, ...usosProv]) cuenta.set(u.medio, (cuenta.get(u.medio) ?? 0) + u._count._all);
  return medios.map((m) => ({
    id: m.id, nombre: m.nombre, tipo: m.tipo as TipoMedio, pideId: m.pideId, activo: m.activo, orden: m.orden,
    usos: cuenta.get(m.nombre) ?? 0,
  }));
}

