import type { Prisma, PrismaClient } from "@prisma/client";

// Solo servidor. El medio de un pago tiene que existir en el gestor y estar activo;
// al editar un pago se acepta también el medio que ya tenía (aunque esté desactivado).
export async function medioValido(
  db: PrismaClient | Prisma.TransactionClient,
  nombre: string,
  actual?: string | null,
): Promise<boolean> {
  if (actual != null && nombre === actual) return true;
  const m = await db.medioPago.findUnique({ where: { nombre }, select: { activo: true } });
  return !!m?.activo;
}
