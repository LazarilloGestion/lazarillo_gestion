import { parseImporteManual } from "./parse-importe-manual";

export type ImporteParaPatch =
  | { ok: true; incluir: true; value: number | null }
  | { ok: true; incluir: false }
  | { ok: false };

// Decide si el PATCH de una compra lleva `importeManual` y con qué valor.
//
// En una compra aperturada el input trae el importe TOTAL de la compra base
// (no la fracción de la fila), y solo se manda si el usuario lo cambió: mandar
// siempre el valor precargado fijaría un override manual igual al importe del
// ERP y marcaría como "editada" una compra que no se tocó. En una compra sin
// apertura se mantiene el comportamiento previo (siempre se manda).
//
// La comparación es numérica, no de strings: "1000.00" y "1000" son el mismo
// importe.
export function resolverImporteParaPatch(input: {
  esDistribuida: boolean;
  importeInput: string;
  importeInicial: string;
}): ImporteParaPatch {
  const actual = parseImporteManual(input.importeInput);
  if (!actual.ok) return { ok: false };

  if (input.esDistribuida) {
    const inicial = parseImporteManual(input.importeInicial);
    if (inicial.ok && inicial.value === actual.value) return { ok: true, incluir: false };
  }

  return { ok: true, incluir: true, value: actual.value };
}
