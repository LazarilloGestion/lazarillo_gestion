import type { Prisma } from "@prisma/client";
import type { DbClient, ETLRowError } from "./types";

/**
 * Ejecuta un INSERT ... ON CONFLICT en lote para `chunk`. Si el lote completo
 * falla (por ejemplo, una sola fila con un valor que viola un constraint),
 * reintenta fila por fila para aislar la fila realmente inválida en vez de
 * perder en silencio todas las filas válidas del lote (bug real: un import
 * de 500 filas con 1 fila corrupta perdía las otras 499 sin dejar rastro).
 *
 * `onRowsInserted` se invoca solo con las filas que efectivamente se
 * persistieron — nunca con las que terminaron en `errors` — así que los
 * contadores created/updated que arma el caller quedan siempre correctos.
 */
export async function insertChunkWithRowFallback<T>(
  prisma: DbClient,
  chunk: T[],
  buildStatement: (rows: T[]) => Prisma.Sql,
  onRowError: (row: T, err: unknown) => ETLRowError,
  onRowsInserted: (rows: T[]) => void
): Promise<ETLRowError[]> {
  try {
    await prisma.$executeRaw(buildStatement(chunk));
    onRowsInserted(chunk);
    return [];
  } catch {
    const errors: ETLRowError[] = [];
    const inserted: T[] = [];
    for (const row of chunk) {
      try {
        await prisma.$executeRaw(buildStatement([row]));
        inserted.push(row);
      } catch (err) {
        errors.push(onRowError(row, err));
      }
    }
    onRowsInserted(inserted);
    return errors;
  }
}
