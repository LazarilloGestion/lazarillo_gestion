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
  | "pagos"
  | "nomina"
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
  // Fila completa (logs viejos no lo traen).
  fila?: number;
  columnas?: Record<string, string>;
}

// Fila del archivo tal como vino: número de fila en el Excel (el encabezado es
// la 1) y TODAS sus columnas como texto, en el orden del archivo. Sirve para que
// en Importar se vea la fila entera de cada omitido/error y se pueda decidir si
// un "repetida" es un duplicado real (punto 7 de Pendientes_desarrollo_etapa3).
export interface ETLFilaCruda {
  fila: number;
  columnas: Record<string, string>;
}

export interface ETLSkippedRow {
  fecha?: string;
  concepto?: string;
  importe?: string;
  proveedor?: string;
  // cargada_en_lazarillo: el comprobante ya se cargó desde el Panel y gana esa versión.
  motivo: "sin_datos" | "duplicado" | "cargada_en_lazarillo";
  // Fila completa de la omitida (logs viejos no lo traen).
  fila?: number;
  columnas?: Record<string, string>;
  // Solo motivo "duplicado": la fila que SÍ se cargó y a la que esta repite
  // (el dedup es "la última gana": se omite la anterior).
  original?: ETLFilaCruda;
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
  | { fileId: string; fileName: string; unsupported: true; errorMessage: string }
  // El archivo no cambió (misma huella de Drive) desde la última importación OK: no se procesó.
  | { fileId: string; fileName: string; sinCambios: true; importadoEn: string };
