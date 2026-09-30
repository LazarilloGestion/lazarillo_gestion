export type ParseImporteManualResult =
  | { ok: true; value: number | null }
  | { ok: false };

// Un input transitorio inválido (ej. "-" solo, mientras el usuario todavía
// está escribiendo un número negativo) hace que parseFloat devuelva NaN. Sin
// este chequeo, JSON.stringify serializa NaN como null y el PATCH interpreta
// null como "borrar el override manual" — silenciosamente pisa un valor real
// con nada (CLAUDE.md §2: ningún error de guardado de dato financiero puede
// fallar en silencio).
export function parseImporteManual(raw: string): ParseImporteManualResult {
  if (raw === "") return { ok: true, value: null };
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}
