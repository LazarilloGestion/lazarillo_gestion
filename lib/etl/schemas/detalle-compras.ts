import { z } from "zod";
import { excelDecimal, excelDate, excelText, excelNormalizedText, requiredExcelText } from "./common";

// FECHA no es identificador acá (a diferencia de compras) — el filtro de
// presencia del normalizer sólo exige COD_CPB y CODIGO. Sigue siendo excelDate
// (no excelText) para que una FECHA presente pero corrupta caiga en errors.
export const detalleCompraRowSchema = z.object({
  COD_CPB: requiredExcelText,
  CODIGO: requiredExcelText,
  COD_PRO: excelText,
  NUMERO1: excelText,
  NUMERO2: excelText,
  FECHA: excelDate,
  NOMBRE: excelNormalizedText,
  MEDIDA: excelText,
  CANTIDAD: excelDecimal,
  NETO: excelDecimal,
  TOTALINS: excelDecimal,
  IVATOT: excelDecimal,
  IMPINTTOT: excelDecimal,
  TASA: excelDecimal,
  IVA: excelDecimal,
  IMP_INT: excelDecimal,
  PERCEP: excelDecimal,
  OBSERVAC: excelNormalizedText,
});

export type DetalleCompraRow = z.infer<typeof detalleCompraRowSchema>;
