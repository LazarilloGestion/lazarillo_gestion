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
 *
 * `chunk` debe venir no-vacío — la función no guarda esa invariante; con un
 * array vacío el comportamiento depende enteramente de qué SQL arme
 * `buildStatement` para cero filas. Los 3 call sites actuales solo invocan
 * esto dentro de un loop que nunca produce un chunk vacío.
 *
 * `prisma` debe ser un `PrismaClient` plano (o el cliente de `getEtlClient()`),
 * nunca uno ya dentro de un `$transaction` activo: si el INSERT de lote falla
 * estando en una transacción, Postgres la aborta y todos los reintentos fila
 * por fila van a fallar también (no se pierde nada en silencio — cada fila
 * termina en `errors` igual — pero el fallback no aporta ninguna recuperación
 * en ese contexto).
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
  } catch (err) {
    console.warn(
      `[insertChunkWithRowFallback] batch insert de ${chunk.length} filas falló, reintentando fila por fila:`,
      err instanceof Error ? err.message : String(err)
    );
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
  onRowsInserted(chunk);
  return [];
}
