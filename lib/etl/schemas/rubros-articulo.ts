import { z } from "zod";
import { excelDate, excelText, excelNormalizedText, excelBool, requiredExcelText } from "./common";

const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

// El ERP exporta DISCONT (flag "discontinuado") como booleano real (true/false), no
// como decimal — a pesar de que la columna en Prisma sigue siendo Decimal? (legado,
// write-only, no se lee en ningún otro lugar de la app; cambiarla a Boolean requeriría
// una migración para un campo sin ningún consumidor real). Se acepta booleano y se
// convierte a "1"/"0" para encajar en la columna existente sin migración. Detectado en
// producción 24-ago-2026: el 100% de las filas de un reimport real fallaban por esto.
const excelDiscont = z
  .unknown()
  .optional()
  .refine(
    (v) => isBlank(v) || v === true || v === false || v === "true" || v === "false" || !isNaN(Number(String(v).trim())),
    { message: "No es un valor numérico ni booleano válido" }
  )
  .transform((v) => {
    if (isBlank(v)) return null;
    if (v === true || v === "true") return "1";
    if (v === false || v === "false") return "0";
    return String(v).trim();
  });

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
  DISCONT: excelDiscont,
  FECHA_UPDA: excelDate,
  MODO_VISTA: excelText,
});

export type RubroArticuloRow = z.infer<typeof rubroArticuloRowSchema>;
