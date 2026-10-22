// Autoselección de local / PDV en los filtros del panel: si hay un solo local
// (instancia de Comercio) o el local elegido tiene un solo PDV (San Justo), no
// tiene sentido obligar a elegirlo a mano — y sin PDV elegido no aparece el
// ícono de apertura. Puro (sin React) para testearlo.

export interface LocalConPdvs {
  id: number;
  puntosDeVenta: { id: number }[];
}

export interface Seleccion {
  localId: number | undefined;
  pdvId: number | undefined;
}

/** Devuelve la selección a aplicar, o null si no hay nada que cambiar. */
export function autoSeleccion(locales: LocalConPdvs[], actual: Seleccion): Seleccion | null {
  if (locales.length === 0) return null;

  let localId = actual.localId;
  if (localId == null && locales.length === 1) localId = locales[0].id;
  if (localId == null) return null;

  const local = locales.find((l) => l.id === localId);
  if (!local) return null;

  let pdvId = actual.pdvId;
  if (pdvId == null && local.puntosDeVenta.length === 1) pdvId = local.puntosDeVenta[0].id;

  if (localId === actual.localId && pdvId === actual.pdvId) return null;
  return { localId, pdvId };
}
