import type { DriveFile } from "@/lib/drive/types";
import type { DriveImportResultItem, ETLReport } from "@/lib/etl/types";
import type { FileErrors, FileImportStatus, FileStates } from "./use-drive-import";

export interface ParsedImportResponse {
  statuses: FileStates;
  errors: FileErrors;
  reports: Record<string, ETLReport>;
  errorCount: number;
  unsupportedCount: number;
  recordCount: number;
}

interface DriveImportResponseBody {
  results?: unknown;
  error?: unknown;
  failedFileId?: unknown;
}

function isResultItem(item: unknown): item is DriveImportResultItem {
  return typeof item === "object" && item !== null && "fileId" in item;
}

/**
 * Traduce la respuesta cruda de POST /api/etl/drive-import al estado por
 * archivo que consume la UI. Un archivo `unsupported` (columnas no
 * reconocidas) queda en su propio status — no cuenta como error ni bloquea
 * la clasificación de los archivos que le siguen en el batch.
 */
export function parseImportResponse(
  files: DriveFile[],
  ok: boolean,
  json: DriveImportResponseBody
): ParsedImportResponse {
  const statuses: FileStates = {};
  const errors: FileErrors = {};
  const reports: Record<string, ETLReport> = {};
  let errorCount = 0;
  let unsupportedCount = 0;
  let recordCount = 0;

  const results = Array.isArray(json.results) ? json.results.filter(isResultItem) : [];

  for (const item of results) {
    if ("sinCambios" in item) {
      // Misma huella de Drive que la última importación OK: no se procesó (no es error).
      statuses[item.fileId] = "sin_cambios";
      const f = new Date(item.importadoEn);
      errors[item.fileId] = `Sin cambios desde la última importación (${f.toLocaleDateString("es-AR")} ${f.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })})`;
      continue;
    }
    if (!("report" in item)) {
      statuses[item.fileId] = "unsupported";
      errors[item.fileId] = item.errorMessage;
      unsupportedCount++;
      continue;
    }

    const { report } = item;
    const totalErrors = report.errors.length;
    const procesadas = report.created + report.updated;
    // Un archivo puede responder 200 con el reporte armado y aun así no haber
    // servido para nada (todas las filas fallaron validación) — eso no es un
    // éxito, aunque no haya sido una excepción HTTP.
    const sinNingunResultado = totalErrors > 0 && procesadas === 0;
    statuses[item.fileId] = sinNingunResultado ? "error" : "success";
    reports[item.fileId] = report;
    if (sinNingunResultado) {
      errorCount++;
      errors[item.fileId] = `${totalErrors} fila${totalErrors !== 1 ? "s" : ""} con error, ninguna se pudo procesar`;
    } else {
      recordCount += procesadas;
    }
  }

  const statusOf = (fileId: string): FileImportStatus | undefined => statuses[fileId];

  if (!ok) {
    const mensaje = typeof json.error === "string" ? json.error : "Error";
    const failedFileId = typeof json.failedFileId === "string" ? json.failedFileId : null;
    if (failedFileId && statusOf(failedFileId) === undefined) {
      statuses[failedFileId] = "error";
      errors[failedFileId] = mensaje;
      errorCount++;
    }
    for (const f of files) {
      if (statusOf(f.id) !== undefined) continue;
      statuses[f.id] = "error";
      errors[f.id] = "No se llegó a procesar: otro archivo del mismo lote falló antes.";
      errorCount++;
    }
  } else {
    for (const f of files) {
      if (statusOf(f.id) !== undefined) continue;
      statuses[f.id] = "error";
      errors[f.id] = "Respuesta inesperada del servidor";
      errorCount++;
    }
  }

  return { statuses, errors, reports, errorCount, unsupportedCount, recordCount };
}
