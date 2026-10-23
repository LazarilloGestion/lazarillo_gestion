// Historial de órdenes de pago entre PDV (solo servidor).
import { Prisma, type PrismaClient } from "@prisma/client";

export type TipoEvento = "creada" | "editada" | "imputada" | "desimputada" | "anulada";

export async function registrarEvento(
  db: PrismaClient | Prisma.TransactionClient,
  e: { pagoId: number; tipo: TipoEvento; detalle?: string | null; importe?: number | null; usuario?: string | null }
) {
  await db.eventoPagoInterno.create({
    data: {
      pagoId: e.pagoId,
      tipo: e.tipo,
      detalle: e.detalle ?? null,
      importe: e.importe == null ? null : new Prisma.Decimal(e.importe),
      usuario: e.usuario ?? null,
    },
  });
}
