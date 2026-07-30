import { z } from "zod";
import { excelDecimal, excelDate, excelText, excelNormalizedText, excelBool, requiredExcelText } from "./common";

export const rubroArticuloRowSchema = z.object({
  CODIGO: requiredExcelText,
  NOMBRE: excelNormalizedText,
  COLOR: excelText,
  GRUPO_NRO: excelText,
  GRUPO_COL: excelText,
  GRUPO_FOT: excelText,
  EXCLUYEINF: excelBool,
  EVENTO: excelText,
  DELIACT: excelBool,
  EVE_FOR: excelText,
  EVE_FORM: excelText,
  EVE_FORMH: excelText,
  DISCONT: excelDecimal,
  FECHA_UPDA: excelDate,
  MODO_VISTA: excelText,
});

export type RubroArticuloRow = z.infer<typeof rubroArticuloRowSchema>;
