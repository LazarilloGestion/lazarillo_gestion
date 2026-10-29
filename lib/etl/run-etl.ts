import { prisma } from "@/lib/prisma";
import { getExcelHeaders, readExcelBuffer } from "./helpers";
import { detectFileType, buildTipoNoIdentificadoMessage } from "./detect-file-type";
import { normalizeRubrosConceptoCaja } from "./normalizers/rubros-concepto-caja";
import { normalizeRubrosArticulo } from "./normalizers/rubros-articulo";
import { normalizeSubrubrosArticulo } from "./normalizers/subrubros-articulo";
import { normalizeConceptosCaja } from "./normalizers/conceptos-caja";
import { normalizeArticulos } from "./normalizers/articulos";
import { normalizeProveedores } from "./normalizers/proveedores";
import { normalizeCompras } from "./normalizers/compras";
import { normalizeDetalleCompras } from "./normalizers/detalle-compras";
import { normalizeVentas } from "./normalizers/ventas";
import { normalizePagos } from "./normalizers/pagos";
import { normalizeNomina } from "./normalizers/nomina";
import type { ETLReport, ETLContext, ETLRow, ETLRowError, ETLSkippedRow, ETLReconciliacionAmbigua, DbClient, ETLFileType } from "./types";

type NormalizerFn = (
  rows: ETLRow[],
  db: DbClient,
  ctx?: ETLContext
) => Promise<{
  created: number;
  updated: number;
  skipped: number;
  skippedRows?: ETLSkippedRow[];
  errors: ETLRowError[];
  comprasDistribuidasModificadas?: string[];
  comprasReconciliadas?: string[];
  reconciliacionesAmbiguas?: ETLReconciliacionAmbigua[];
  ventasQuitadas?: number;
}>;

const NORMALIZERS: Record<string, NormalizerFn> = {
  rubrosConceptoCaja: normalizeRubrosConceptoCaja,
  rubrosArticulo:     normalizeRubrosArticulo,
  subrubrosArticulo:  normalizeSubrubrosArticulo,
  conceptosCaja:      normalizeConceptosCaja,
  articulos:          normalizeArticulos,
  proveedores:        normalizeProveedores,
  compras:            normalizeCompras,
  detalleCompras:     normalizeDetalleCompras,
  pagos:              normalizePagos,
  nomina:             normalizeNomina,
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
    throw new Error(buildTipoNoIdentificadoMessage(headers));
  }

  const rows = readExcelBuffer(buffer);
  const normalizer = NORMALIZERS[fileType];
  if (!normalizer)
    throw new Error(`No hay normalizer registrado para el tipo de archivo: ${fileType}`);
  const client = db ?? (prisma as unknown as DbClient);
  const {
    created, updated, skipped, skippedRows, errors,
    comprasDistribuidasModificadas, comprasReconciliadas, reconciliacionesAmbiguas, ventasQuitadas,
  } = await normalizer(rows, client, ctx);

  return {
    fileType,
    totalRows: rows.length,
    created,
    updated,
    skipped,
    skippedRows,
    errors,
    comprasDistribuidasModificadas,
    comprasReconciliadas,
    reconciliacionesAmbiguas,
    ventasQuitadas,
    durationMs: Date.now() - startMs,
    storagePath,
  };
}

// Mismo proceso que runETL pero con las filas ya armadas (sin Excel): lo usa la
// lectura directa desde Render (lib/render). Las filas tienen que venir con la
// misma forma que readExcelBuffer (claves en mayúscula, fechas como serial de
// Excel) para que el rowId sea el mismo que al importar el archivo.
export async function runETLFilas(
  fileType: ETLFileType,
  rows: ETLRow[],
  ctx: ETLContext,
  db: DbClient
): Promise<ETLReport> {
  const startMs = Date.now();
  const normalizer = NORMALIZERS[fileType];
  if (!normalizer) throw new Error(`No hay normalizer registrado para el tipo de archivo: ${fileType}`);
  const {
    created, updated, skipped, skippedRows, errors,
    comprasDistribuidasModificadas, comprasReconciliadas, reconciliacionesAmbiguas, ventasQuitadas,
  } = await normalizer(rows, db, ctx);
  return {
    fileType,
    totalRows: rows.length,
    created,
    updated,
    skipped,
    skippedRows,
    errors,
    comprasDistribuidasModificadas,
    comprasReconciliadas,
    reconciliacionesAmbiguas,
    ventasQuitadas,
    durationMs: Date.now() - startMs,
  };
}
