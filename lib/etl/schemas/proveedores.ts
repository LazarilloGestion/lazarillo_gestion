import { z } from "zod";
import {
  excelText,
  excelNormalizedText,
  excelPhone,
  excelCuit,
  excelInt,
  excelBool,
  requiredExcelText,
} from "./common";

export const proveedorRowSchema = z.object({
  CODIGO: requiredExcelText,
  NOMBRE: excelNormalizedText,
  RAZON: excelNormalizedText,
  DIRECCION: excelNormalizedText,
  LOCALIDAD: excelNormalizedText,
  CONTACTO: excelNormalizedText,
  TELEFONO: excelPhone,
  FAX: excelPhone,
  CELULAR: excelPhone,
  TIPO_IVA: excelText,
  CUIT: excelCuit,
  CBU: excelText,
  ALIASCBU: excelText,
  DIAS_VENC: excelInt,
  IVA: excelBool,
  IVA_DIF: excelBool,
  E_MAIL: excelText,
  OBSERVAC: excelNormalizedText,
  DETPERC: excelText,
});

export type ProveedorRow = z.infer<typeof proveedorRowSchema>;
