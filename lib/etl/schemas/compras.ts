import { z } from "zod";
import { safeDate } from "../helpers";
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
  // Columnas que suma el kit (26/10/2026) para gastos varios y sueldos. Opcionales y
  // tolerantes: los 14 viejos no las traen, y una fecha rota no tira la fila.
  FECHA_PAGO: z.unknown().optional().transform((v) => safeDate(v)),
  CAJA_PAGO: excelText,
  PERIODO: z.unknown().optional().transform((v) => safeDate(v)),
});

export type CompraRow = z.infer<typeof compraRowSchema>;
