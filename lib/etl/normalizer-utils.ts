import type { PrismaClient } from "@prisma/client";
import type { ETLRowError } from "./types";

const BATCH_SIZE = 50;

// Vincula detalle_compras.compraId por coincidencia de comprobante.
// Se llama al final de normalizeCompras y normalizeDetalleCompras para
// que el orden de importación no afecte el vínculo.
export async function linkDetalleComprasByComprobante(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`
    UPDATE detalle_compras dc
    SET "compraId" = c."rowId"
    FROM compras c
    WHERE dc.comprobante = c.comprobante
      AND dc."compraId" IS NULL
  `;
}

// Procesa un array de items en batches concurrentes de BATCH_SIZE.
// Retorna los errores por fila; no aborta el lote ante fallos parciales.
export async function processBatch<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  getRawCodigo: (item: T) => unknown
): Promise<ETLRowError[]> {
  const errors: ETLRowError[] = [];

  for (let b = 0; b < items.length; b += BATCH_SIZE) {
    const batch = items.slice(b, b + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((item, localIdx) => fn(item, b + localIdx))
    );
    results.forEach((result, localIdx) => {
      if (result.status === "rejected") {
        errors.push({
          rowIndex: b + localIdx,
          rawCodigo: getRawCodigo(batch[localIdx]),
          message:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    });
  }

  return errors;
}
