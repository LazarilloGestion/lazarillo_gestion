import { z } from "zod";
import {
  excelDecimal,
  excelText,
  excelNormalizedText,
  requiredExcelText,
  requiredExcelDate,
} from "./common";

export const compraRowSchema = z.object({
  COD_CGA: requiredExcelText,
  FECHA: requiredExcelDate,
  CONCEPTO: excelText,
  DETALLE: excelText,
  CODIGO: excelText,
  PROVEEDOR: excelText,
  OBSERVAC: excelNormalizedText,
  IMPORTE: excelDecimal,
  IMP_INT: excelDecimal,
  IMPUTAC: excelText,
  PER1: excelDecimal,
  PER2: excelDecimal,
  PER3: excelDecimal,
});

export type CompraRow = z.infer<typeof compraRowSchema>;
