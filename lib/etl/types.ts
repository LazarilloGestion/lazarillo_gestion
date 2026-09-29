import type { PrismaClient } from "@prisma/client";

// Compatible con PrismaClient y con el cliente de transacción (sin $connect/$disconnect/$transaction)
export type DbClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type ETLFileType =
  | "rubrosConceptoCaja"
  | "rubrosArticulo"
  | "subrubrosArticulo"
  | "conceptosCaja"
  | "articulos"
  | "proveedores"
  | "compras"
  | "detalleCompras"
  | "ventas";

export type ETLRow = Record<string, unknown>;

export interface ETLContext {
  localId?: number;
  puntoDeVentaId?: number;
}

export interface ETLRowError {
  rowIndex: number;
  rawCodigo: unknown;
  message: string;
}

export interface ETLSkippedRow {
  fecha?: string;
  concepto?: string;
  importe?: string;
  proveedor?: string;
  motivo: "sin_datos" | "duplicado";
}

export interface ETLReconciliacionAmbigua {
  rowIdNuevo: string;
  candidatos: string[];
}

export interface ETLReport {
  fileType: ETLFileType;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  skippedRows?: ETLSkippedRow[];
  errors: ETLRowError[];
  comprasDistribuidasModificadas?: string[];
  comprasReconciliadas?: string[];
  reconciliacionesAmbiguas?: ETLReconciliacionAmbigua[];
  durationMs: number;
  storagePath?: string;
}

// Resultado por archivo de POST /api/etl/drive-import: o bien se pudo
// identificar el tipo y correr el ETL (con o sin errores fila a fila), o
// las columnas no matchean ningún ETLFileType conocido — en ese caso no se
// llega a invocar el normalizer, no hay ETLReport, y el archivo se ignora
// sin abortar el resto del batch (a diferencia de una excepción real).
export type DriveImportResultItem =
  | { fileId: string; fileName: string; report: ETLReport }
  | { fileId: string; fileName: string; unsupported: true; errorMessage: string };
