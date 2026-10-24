import { destinosSuperpuestos, type DestinoBasico } from "./validaciones";

type LocalMin = { id: number; puntosDeVenta: { id: number }[] };
type Destino = { localId: number | null; puntoDeVentaId: number | null };

// Puntos de venta que todavía se pueden elegir en un local sin pisar a las
// otras filas (null = "Todo el local"). Si el local tiene UN solo punto de
// venta, "Todo el local" y ese PDV son lo mismo: se ofrece solo el PDV.
export function opcionesDisponibles(local: LocalMin, otros: DestinoBasico[]): (number | null)[] {
  const libre = (puntoDeVentaId: number | null) =>
    !otros.some((o) => destinosSuperpuestos({ localId: local.id, puntoDeVentaId }, o));
  const pdvs = local.puntosDeVenta.map((p) => p.id).filter(libre);
  if (local.puntosDeVenta.length === 1) return pdvs;
  return libre(null) ? [null, ...pdvs] : pdvs;
}

// Completa sola la fila de destino cuando queda una única opción (Diego, 24/10):
//  - sin local: si solo un local tiene lugar, se elige ese;
//  - con local: si lo elegido choca con otra fila (ej. "Todo el local" con Bar
//    ya usado), pasa a la primera opción libre; si queda una sola, esa.
export function autocompletarDestino<T extends Destino>(destino: T, locales: LocalMin[], otros: DestinoBasico[]): T {
  let d = destino;
  if (d.localId == null) {
    const conLugar = locales.filter((l) => opcionesDisponibles(l, otros).length > 0);
    if (conLugar.length !== 1) return d;
    d = { ...d, localId: conLugar[0].id, puntoDeVentaId: null };
  }
  const local = locales.find((l) => l.id === d.localId);
  if (!local) return d;
  const opciones = opcionesDisponibles(local, otros);
  if (opciones.length === 0) return d;
  if (opciones.length === 1) return { ...d, puntoDeVentaId: opciones[0] };
  return opciones.includes(d.puntoDeVentaId) ? d : { ...d, puntoDeVentaId: opciones[0] };
}
