import { z } from "zod";
import { excelDecimal, excelNormalizedText, excelInt, requiredExcelText } from "./common";

export const articuloRowSchema = z.object({
  CODIGO: requiredExcelText,
  NOMBRE: excelNormalizedText,
  PRECIO1: excelDecimal,
  PRECIO2: excelDecimal,
  PRECIO3: excelDecimal,
  PRECIO4: excelDecimal,
  COD_RUA: excelInt,
  COD_SUA: excelInt,
});

export type ArticuloRow = z.infer<typeof articuloRowSchema>;
