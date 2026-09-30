export type ParseImporteManualResult =
  | { ok: true; value: number | null }
  | { ok: false };

// Un input transitorio inválido (ej. "-" solo, mientras el usuario todavía
// está escribiendo un número negativo) hace que parseFloat devuelva NaN. Sin
// este chequeo, JSON.stringify serializa NaN como null y el PATCH interpreta
// null como "borrar el override manual" — silenciosamente pisa un valor real
// con nada (CLAUDE.md §2: ningún error de guardado de dato financiero puede
// fallar en silencio).
//
// Usa Number(...) en vez de parseFloat(...) a propósito: parseFloat hace
// parseo parcial ("12abc" -> 12, "1.2.3" -> 1.2), lo que aceptaría en
// silencio un input corrupto como si fuera un número válido pero distinto
// del que el usuario escribió. Number(...) rechaza cualquier resto no
// numérico entero (revisión final de rama, 29-sep-2026).
export function parseImporteManual(raw: string): ParseImporteManualResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}
