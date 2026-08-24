import { z } from "zod";
import { toDecimalStr, safeDate, toBool, trim, normalizeText, normalizePhone, normalizeCuit } from "../helpers";

// Estos primitivos NO reemplazan los helpers de ../helpers.ts (toDecimalStr, safeDate,
// toBool ya resuelven bien la coerción — toDecimalStr en particular evita drift de float
// a propósito devolviendo string). Lo que faltaba es distinguir "celda vacía" (null,
// válido) de "celda con contenido que no parsea" (dato corrupto, antes se perdía como
// null en silencio) — eso es lo que agrega el .refine() de cada primitivo acá.

const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

/** null si la celda está vacía; string numérico si es válida; error si tiene
 *  contenido pero no parsea (antes se perdía como null en silencio). */
// .optional() en cada primitivo tolerante: XLSX.utils.sheet_to_json omite la key del
// objeto por completo cuando una celda está en blanco (no le pone `undefined`). Zod 3
// aceptaba una key ausente en z.unknown() sin más; Zod 4 (repo en ^4.4.3) la rechaza como
// "expected nonoptional" salvo que el schema declare .optional() explícitamente —
// regresión real detectada en producción el 24-ago-2026 (Rubros Artículo/Subrubros
// Articulo/Proveedores fallando el 100% de las filas en columnas habitualmente vacías).
export const excelDecimal = z
  .unknown()
  .optional()
  .refine((v) => isBlank(v) || !isNaN(Number(String(v).trim())), { message: "No es un valor numérico válido" })
  .transform((v) => toDecimalStr(v));

/** Igual que excelDecimal pero para fechas (serial Excel). */
export const excelDate = z
  .unknown()
  .optional()
  .refine((v) => isBlank(v) || safeDate(v) !== null, { message: "No es una fecha válida" })
  .transform((v) => safeDate(v));

/** Igual que excelDecimal pero devuelve number (no string) — para columnas
 *  enteras simples (ej. DIAS_VENC) donde no aplica el cuidado anti-drift de
 *  toDecimalStr (que es específico de columnas monetarias). */
export const excelInt = z
  .unknown()
  .optional()
  .refine((v) => isBlank(v) || !isNaN(Number(String(v).trim())), { message: "No es un valor numérico válido" })
  .transform((v) => (isBlank(v) ? null : Number(String(v).trim())));

const BOOL_LIKE = new Set<unknown>([true, false, 0, 1, "0", "1", "true", "false"]);

/** Igual que excelDecimal pero para booleanos (IVA, IVA_DIF, etc.). */
export const excelBool = z
  .unknown()
  .optional()
  .refine((v) => isBlank(v) || BOOL_LIKE.has(v), { message: "No es un valor booleano válido" })
  .transform((v) => toBool(v));

/** Texto libre: siempre válido, sólo trimea (sin capitalizar). */
export const excelText = z.unknown().optional().transform((v) => trim(v));

/** Texto libre normalizado (trim + colapsa espacios + capitaliza) — usado en
 *  campos descriptivos como OBSERVAC, NOMBRE. */
export const excelNormalizedText = z.unknown().optional().transform((v) => normalizeText(v));

/** Teléfono: normaliza formato pero nunca falla. */
export const excelPhone = z.unknown().optional().transform((v) => normalizePhone(v));

/** CUIT: normaliza formato pero nunca falla. */
export const excelCuit = z.unknown().optional().transform((v) => normalizeCuit(v));

/** Campo identificador obligatorio (ej. CODIGO). */
export const requiredExcelText = z
  .unknown()
  .refine((v) => !isBlank(v), { message: "Campo obligatorio faltante" })
  .transform((v) => trim(v) as string);

/** Fecha identificadora obligatoria (ej. FECHA en compras/detalle-compras) — a
 *  diferencia de excelDate, una fecha presente pero no parseable es inválida,
 *  no null. El filtro "sin_datos" de cada normalizer sólo detecta ausencia; esto
 *  cubre el caso "hay algo en la celda pero no es una fecha real". */
export const requiredExcelDate = z
  .unknown()
  .refine((v) => !isBlank(v) && safeDate(v) !== null, { message: "Fecha obligatoria inválida o faltante" })
  .transform((v) => safeDate(v) as Date);

/** Formatea un ZodError en un string legible para ETLRowError.message. */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
