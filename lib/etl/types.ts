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

export interface ETLReport {
  fileType: ETLFileType;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  skippedRows?: ETLSkippedRow[];
  errors: ETLRowError[];
  durationMs: number;
  storagePath?: string;
}
