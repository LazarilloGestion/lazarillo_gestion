import { z } from "zod";
import { excelDate, excelText, excelNormalizedText, excelBool, excelInt, requiredExcelText } from "./common";

export const subrubroArticuloRowSchema = z.object({
  CODIGO: requiredExcelText,
  NOMBRE: excelNormalizedText,
  DELIACT: excelBool,
  EVE_FOR: excelText,
  EVE_FORM: excelText,
  EVE_FORMH: excelText,
  FECHA_UPDA: excelDate,
  COD_RUA: excelInt,
});

export type SubrubroArticuloRow = z.infer<typeof subrubroArticuloRowSchema>;
