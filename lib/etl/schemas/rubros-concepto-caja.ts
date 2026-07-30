import { z } from "zod";
import { excelText, excelNormalizedText, requiredExcelText } from "./common";

export const rubroConceptoCajaRowSchema = z.object({
  CODIGO: requiredExcelText,
  NOMBRE: excelNormalizedText,
  CALC_RENT: excelText,
});

export type RubroConceptoCajaRow = z.infer<typeof rubroConceptoCajaRowSchema>;
