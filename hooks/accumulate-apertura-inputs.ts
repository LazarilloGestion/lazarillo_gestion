import type { ETLReport } from "@/lib/etl/types";

export interface AperturaInputs {
  huboComprasTocadas: boolean;
  comprasModificadas: string[];
}

/**
 * Junta, a través de todas las tandas de una carpeta, lo que
 * POST /api/etl/drive-import/finalizar necesita para sincronizar apertura
 * una sola vez al final — mismo criterio que antes usaba
 * sincronizarAperturaSiCorresponde en el servidor por request.
 */
export function accumulateAperturaInputs(reports: ETLReport[]): AperturaInputs {
  const huboComprasTocadas = reports.some(
    (r) => r.fileType === "compras" && (r.created > 0 || r.updated > 0)
  );
  const comprasModificadas = reports.flatMap((r) => r.comprasDistribuidasModificadas ?? []);
  return { huboComprasTocadas, comprasModificadas };
}
