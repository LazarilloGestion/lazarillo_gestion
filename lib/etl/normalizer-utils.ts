import type { DbClient, ETLRowError } from "./types";

const BATCH_SIZE = 50;

// Pre-carga los códigos existentes en un Set para O(1) lookup durante upsert.
export async function preloadExistingCodes(
  codigos: string[],
  fetcher: (codes: string[]) => Promise<Array<{ codigo: string }>>
): Promise<Set<string>> {
  if (codigos.length === 0) return new Set();
  const existing = await fetcher(codigos);
  return new Set(existing.map((x) => x.codigo));
}

// Vincula detalle_compras.compraId por coincidencia de comprobante.
// Se llama al final de normalizeCompras y normalizeDetalleCompras para
// que el orden de importación no afecte el vínculo.
// localId es obligatorio para evitar links cruzados entre locales.
export async function linkDetalleComprasByComprobante(prisma: DbClient, localId: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE detalle_compras dc
    SET "compraId" = c."rowId"
    FROM compras c
    WHERE dc.comprobante = c.comprobante
      AND dc."compraId" IS NULL
      AND dc."localId" = ${localId}
      AND c."localId" = ${localId}
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
