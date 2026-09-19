// Compara el texto crudo de proveedor de una fila del ERP contra el nombre/razón
// de un proveedor candidato del maestro, normalizando ambos (minúsculas, sin
// signos de puntuación) antes de comparar. Evita confiar ciegamente en un CODIGO
// que coincide por azar con el código de un proveedor real cuando el CODIGO en
// realidad identifica otra cosa (empleado de planilla, "GASTOS VARIOS", etc.) —
// ver docs/superpowers/specs/2026-09-19-cruce-proveedorid-compras-design.md.
//
// Asimetría intencional: sin texto para comparar (null), se confía en el código
// (no hay evidencia en contra). Con texto que no matchea ni nombre ni razón, se
// descarta el link — preferible "Sin Proveedor" a una empresa incorrecta.
export interface ProveedorCandidato {
  id: number;
  nombre: string | null;
  razon: string | null;
}

// NFD + strip de marcas combinantes ANTES de descartar lo no-alfanumérico: sin
// eso, "Agustín" perdería la "í" entera (no es [a-z0-9]) y dejaría de coincidir
// con "Agustin" del maestro, desvinculando un proveedor correcto solo porque un
// lado del dato está acentuado y el otro no.
function normalizarParaComparar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function proveedorTextoCoincide(
  textoCrudo: string | null,
  candidato: { nombre: string | null; razon: string | null }
): boolean {
  if (textoCrudo == null) return true;
  const t = normalizarParaComparar(textoCrudo);
  return (
    (candidato.nombre != null && normalizarParaComparar(candidato.nombre) === t) ||
    (candidato.razon != null && normalizarParaComparar(candidato.razon) === t)
  );
}

export function resolveProveedorId(
  codigoFila: string | null,
  textoProveedor: string | null,
  provMap: Map<string, ProveedorCandidato>
): number | null {
  if (codigoFila == null) return null;
  const candidato = provMap.get(codigoFila);
  if (!candidato) return null;
  return proveedorTextoCoincide(textoProveedor, candidato) ? candidato.id : null;
}
