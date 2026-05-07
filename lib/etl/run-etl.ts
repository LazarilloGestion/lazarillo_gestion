import { prisma } from "@/lib/prisma";
import { getExcelHeaders, readExcelBuffer } from "./helpers";
import { detectFileType } from "./detect-file-type";
import { normalizeRubrosConceptoCaja } from "./normalizers/rubros-concepto-caja";
import { normalizeRubrosArticulo } from "./normalizers/rubros-articulo";
import { normalizeSubrubrosArticulo } from "./normalizers/subrubros-articulo";
import { normalizeConceptosCaja } from "./normalizers/conceptos-caja";
import { normalizeArticulos } from "./normalizers/articulos";
import { normalizeProveedores } from "./normalizers/proveedores";
import type { ETLReport } from "./types";

const NORMALIZERS = {
  rubrosConceptoCaja: normalizeRubrosConceptoCaja,
  rubrosArticulo: normalizeRubrosArticulo,
  subrubrosArticulo: normalizeSubrubrosArticulo,
  conceptosCaja: normalizeConceptosCaja,
  articulos: normalizeArticulos,
  proveedores: normalizeProveedores,
} as const;

export async function runETL(
  buffer: Buffer,
  storagePath?: string
): Promise<ETLReport> {
  const startMs = Date.now();

  const headers = getExcelHeaders(buffer);
  const fileType = detectFileType(headers);

  if (!fileType) {
    throw new Error(
      `No se pudo identificar el tipo de archivo. Columnas encontradas: ${headers.join(", ")}`
    );
  }

  const rows = readExcelBuffer(buffer);
  const normalizer = NORMALIZERS[fileType];
  const { created, updated, skipped, errors } = await normalizer(rows, prisma);

  return {
    fileType,
    totalRows: rows.length,
    created,
    updated,
    skipped,
    errors,
    durationMs: Date.now() - startMs,
    storagePath,
  };
}
