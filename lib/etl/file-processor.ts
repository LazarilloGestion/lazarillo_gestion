import { getExcelHeaders } from "./helpers";
import { detectFileType } from "./detect-file-type";

export const DEPENDENCY_ORDER = [
  "rubrosConceptoCaja",
  "rubrosArticulo",
  "subrubrosArticulo",
  "conceptosCaja",
  "articulos",
  "proveedores",
  "compras",
  "detalleCompras",
  "ventas",
] as const;

export function getFileOrder(buffer: Buffer): number {
  const headers = getExcelHeaders(buffer);
  const fileType = detectFileType(headers);
  const idx = fileType ? DEPENDENCY_ORDER.indexOf(fileType as typeof DEPENDENCY_ORDER[number]) : -1;
  return idx === -1 ? 999 : idx;
}
