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

export interface ETLReport {
  fileType: ETLFileType;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ETLRowError[];
  durationMs: number;
  storagePath?: string;
}
