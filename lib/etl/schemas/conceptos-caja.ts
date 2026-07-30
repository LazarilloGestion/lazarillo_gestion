import { z } from "zod";
import { excelText, excelNormalizedText, excelInt, requiredExcelText } from "./common";

export const conceptoCajaRowSchema = z.object({
  CODIGO: requiredExcelText,
  NOMBRE: excelNormalizedText,
  TIPO: excelText,
  COD_IMP: excelText,
  COD_RGA: excelInt,
});

export type ConceptoCajaRow = z.infer<typeof conceptoCajaRowSchema>;
