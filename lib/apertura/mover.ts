// "Mover a otro PDV" (Diego, 24/10/2026): un gasto entero pasa a otro punto de
// venta. Por dentro es la apertura de siempre a nivel registro, 100% a un solo
// destino, así que se deshace igual que cualquier apertura (⅄ → eliminar regla).

type FilaMovible = { rowId: string; localIdOrigen: number | null; puntoDeVentaIdOrigen: number | null };
type LocalMin = { id: number; nombre: string; puntosDeVenta: { id: number; nombre: string }[] };

export type DestinoMover = { localId: number; puntoDeVentaId: number; etiqueta: string; deshabilitado: boolean };

// Sobre qué filas actúa el ícono de una fila: si esa fila está tildada, sobre
// todas las tildadas; si no, solo sobre ella. Una compra distribuida aparece
// N veces con el mismo rowId: se mueve una sola vez.
export function objetivosMover<T extends FilaMovible>(fila: T, tildadas: Set<string>, visibles: T[]): T[] {
  const base = tildadas.has(fila.rowId) ? visibles.filter((r) => tildadas.has(r.rowId)) : [fila];
  const vistos = new Set<string>();
  return base.filter((r) => (vistos.has(r.rowId) ? false : (vistos.add(r.rowId), true)));
}

// Opciones del popover: todos los PDV; el de origen queda deshabilitado
// cuando TODAS las filas a mover ya están ahí.
export function destinosMover(locales: LocalMin[], filas: FilaMovible[]): DestinoMover[] {
  const origenes = new Set(filas.map((f) => f.puntoDeVentaIdOrigen));
  return locales.flatMap((l) =>
    l.puntosDeVenta.map((p) => ({
      localId: l.id,
      puntoDeVentaId: p.id,
      etiqueta: `${l.nombre} · ${p.nombre}`,
      deshabilitado: origenes.size === 1 && origenes.has(p.id),
    }))
  );
}

// Cuerpo de POST /api/apertura/reglas para mover una fila.
export function cuerpoMover(fila: FilaMovible, destino: { localId: number; puntoDeVentaId: number }) {
  return {
    nivel: "registro" as const,
    entidadId: fila.rowId,
    origenLocalId: fila.localIdOrigen,
    origenPuntoDeVentaId: fila.puntoDeVentaIdOrigen,
    modo: "historico" as const,
    fechaDesde: null,
    fechaHasta: null,
    extremosInclusivos: true,
    confirmarHistorico: true,
    destinos: [{ localId: destino.localId, puntoDeVentaId: destino.puntoDeVentaId, porcentaje: 100 }],
  };
}

// Las que ya están en ese PDV no se mandan (no hay nada que mover).
export function filasAMover<T extends FilaMovible>(filas: T[], destino: { puntoDeVentaId: number }): T[] {
  return filas.filter((f) => f.puntoDeVentaIdOrigen !== destino.puntoDeVentaId);
}
