import type { ETLFileType } from "./types";

// Orden importa: más específico primero para evitar falsos positivos.
const DETECTION_RULES: [ETLFileType, string[]][] = [
  ["rubrosArticulo",     ["GRUPO_NRO", "GRUPO_COL", "GRUPO_FOT", "EXCLUYEINF"]],
  ["subrubrosArticulo",  ["EVE_FOR", "EVE_FORM", "EVE_FORMH"]],
  ["rubrosConceptoCaja", ["CODIGO", "NOMBRE", "CALC_RENT"]],
  ["conceptosCaja",      ["TIPO", "COD_IMP", "COD_RGA"]],
  ["articulos",          ["PRECIO1", "PRECIO2", "PRECIO3", "PRECIO4"]],
  ["proveedores",        ["RAZON", "CUIT", "CBU", "ALIASCBU"]],
];

export function detectFileType(headers: string[]): ETLFileType | null {
  const headerSet = new Set(headers.map((h) => h.trim().toUpperCase()));
  for (const [fileType, required] of DETECTION_RULES) {
    if (required.every((h) => headerSet.has(h))) {
      return fileType;
    }
  }
  return null;
}
