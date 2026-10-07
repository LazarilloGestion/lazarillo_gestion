export interface AperturaFinalizar {
  errores?: string[];
  omitidas?: string[];
}

export type FinalizarResultado =
  | { tipo: "ok"; apertura: AperturaFinalizar | null }
  | { tipo: "fallo"; motivo: string };

/**
 * Interpreta la respuesta de POST /api/etl/drive-import/finalizar. Un fallo
 * (HTTP no-OK o cuerpo ilegible, como el 504 de Vercel al cortar la función)
 * significa que NO se sabe si la apertura se aplicó: la UI tiene que avisarlo,
 * no tragarlo. `json` es null cuando el cuerpo no se pudo parsear.
 */
export function parseFinalizarResponse(ok: boolean, status: number, json: unknown): FinalizarResultado {
  const cuerpo = typeof json === "object" && json !== null ? (json as { error?: unknown; apertura?: unknown }) : null;

  if (!ok) {
    const motivo = typeof cuerpo?.error === "string" ? cuerpo.error : `el servidor respondió HTTP ${status}`;
    return { tipo: "fallo", motivo };
  }
  if (cuerpo === null) return { tipo: "fallo", motivo: "respuesta ilegible del servidor" };

  const apertura = typeof cuerpo.apertura === "object" && cuerpo.apertura !== null ? (cuerpo.apertura as AperturaFinalizar) : null;
  return { tipo: "ok", apertura };
}
