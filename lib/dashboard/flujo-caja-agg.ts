// Agregación pura de FlujoCajaManual por mes — extraída de app/api/dashboard/flujo-caja/route.ts
// para poder testear la lógica de precedencia local/PDV sin tocar la base de datos.

export interface FlujoCajaRow {
  localId: number | null;
  puntoDeVentaId: number | null;
  mes: number;
  monto: number;
}

// Si se pide un PDV puntual no hay ambigüedad de niveles, se suma directo. Si no (vista
// "todos los PDV" de un local, o "todos los locales"), por cada local+mes se prioriza la fila
// "todo el local" (puntoDeVentaId null) sobre la suma de PDVs — si se cargó a los dos niveles
// para el mismo mes, evita duplicar.
export function aggregateFlujoCajaPorMes(
  rows: FlujoCajaRow[],
  puntoDeVentaId?: number,
): Record<number, number | null> {
  const meses: Record<number, number | null> = {};
  for (let m = 1; m <= 12; m++) meses[m] = null;

  if (puntoDeVentaId !== undefined) {
    for (const row of rows) {
      meses[row.mes] = (meses[row.mes] ?? 0) + row.monto;
    }
    return meses;
  }

  const porLocalYMes = new Map<string, { local: number | null; pdv: number; mes: number }>();
  for (const row of rows) {
    const key = `${row.localId ?? "null"}:${row.mes}`;
    const entry = porLocalYMes.get(key) ?? { local: null, pdv: 0, mes: row.mes };
    if (row.puntoDeVentaId == null) {
      entry.local = (entry.local ?? 0) + row.monto;
    } else {
      entry.pdv += row.monto;
    }
    porLocalYMes.set(key, entry);
  }
  for (const { local, pdv, mes } of porLocalYMes.values()) {
    meses[mes] = (meses[mes] ?? 0) + (local ?? pdv);
  }
  return meses;
}
