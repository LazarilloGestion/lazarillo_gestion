import { prisma } from "@/lib/prisma";
import { getExcelHeaders, readExcelBuffer } from "./helpers";
import { detectFileType } from "./detect-file-type";
import { normalizeRubrosConceptoCaja } from "./normalizers/rubros-concepto-caja";
import { normalizeRubrosArticulo } from "./normalizers/rubros-articulo";
import { normalizeSubrubrosArticulo } from "./normalizers/subrubros-articulo";
import { normalizeConceptosCaja } from "./normalizers/conceptos-caja";
import { normalizeArticulos } from "./normalizers/articulos";
import { normalizeProveedores } from "./normalizers/proveedores";
import { normalizeCompras } from "./normalizers/compras";
import { normalizeDetalleCompras } from "./normalizers/detalle-compras";
import { normalizeVentas } from "./normalizers/ventas";
import type { ETLReport, ETLContext, ETLRow, ETLRowError, DbClient } from "./types";

type NormalizerFn = (
  rows: ETLRow[],
  db: DbClient,
  ctx?: ETLContext
) => Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }>;

const NORMALIZERS: Record<string, NormalizerFn> = {
  rubrosConceptoCaja: normalizeRubrosConceptoCaja,
  rubrosArticulo:     normalizeRubrosArticulo,
  subrubrosArticulo:  normalizeSubrubrosArticulo,
  conceptosCaja:      normalizeConceptosCaja,
  articulos:          normalizeArticulos,
  proveedores:        normalizeProveedores,
  compras:            normalizeCompras,
  detalleCompras:     normalizeDetalleCompras,
  ventas:             normalizeVentas,
};

export async function runETL(
  buffer: Buffer,
  storagePath?: string,
  ctx?: ETLContext,
  db?: DbClient
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
  if (!normalizer)
    throw new Error(`No hay normalizer registrado para el tipo de archivo: ${fileType}`);
  const client = db ?? (prisma as unknown as DbClient);
  const { created, updated, skipped, errors } = await normalizer(rows, client, ctx);

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
