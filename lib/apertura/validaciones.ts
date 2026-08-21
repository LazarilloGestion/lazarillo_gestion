import type { ReglaVigencia } from "./vigencia";

// Tolerancia de redondeo — reparto en 3 con decimales periódicos (33.33 x3 =
// 99.99, no 100) es válido en la práctica (spec no exige más de 2 decimales
// por destino). No confundir con la corrección exacta a nivel importe, que
// calcularDistribuciones ya garantiza vía "el último se lleva el resto".
const TOLERANCIA = 0.01;

export function validarSumaPorcentajes(destinos: { porcentaje: number }[]): boolean {
  if (destinos.length === 0) return false;
  const suma = destinos.reduce((acc, d) => acc + d.porcentaje, 0);
  return Math.abs(suma - 100) <= TOLERANCIA;
}

interface Intervalo {
  desde: number; // epoch ms; -Infinity para "sin límite inferior"
  desdeInclusivo: boolean;
  hasta: number; // epoch ms; +Infinity para "sin límite superior"
  hastaInclusivo: boolean;
}

function aIntervalo(r: ReglaVigencia): Intervalo {
  if (r.modo === "historico") {
    return { desde: -Infinity, desdeInclusivo: true, hasta: Infinity, hastaInclusivo: true };
  }
  const desde = r.modo === "desde_atras" ? -Infinity : r.fechaDesde!.getTime();
  const hasta = r.modo === "desde_adelante" ? Infinity : r.fechaHasta!.getTime();
  return {
    desde,
    desdeInclusivo: r.modo === "desde_atras" ? true : r.extremosInclusivos,
    hasta,
    hastaInclusivo: r.modo === "desde_adelante" ? true : r.extremosInclusivos,
  };
}

function seSuperponen(a: Intervalo, b: Intervalo): boolean {
  const aTerminaAntesDeB = a.hasta < b.desde || (a.hasta === b.desde && !(a.hastaInclusivo && b.desdeInclusivo));
  const bTerminaAntesDeA = b.hasta < a.desde || (b.hasta === a.desde && !(b.hastaInclusivo && a.desdeInclusivo));
  return !aTerminaAntesDeB && !bTerminaAntesDeA;
}

// Devuelve el id de la primera regla existente que se superpone con `nueva`,
// o null si no hay conflicto. `existentes` debe venir pre-filtrado por el
// caller (mismo entidadId + estado 'activa' — ver route handler, Task 7).
export function encontrarSuperposicion(
  nueva: ReglaVigencia,
  existentes: (ReglaVigencia & { id: number })[]
): number | null {
  const intNueva = aIntervalo(nueva);
  for (const existente of existentes) {
    if (seSuperponen(intNueva, aIntervalo(existente))) return existente.id;
  }
  return null;
}

export interface DestinoBasico {
  localId: number | null;
  puntoDeVentaId: number | null;
}

// Dos destinos compiten por la misma plata cuando son del mismo local y
// además: apuntan al mismo punto de venta específico, o al menos uno de los
// dos es "todo el local" (puntoDeVentaId null) — "todo el local" ya incluye
// la plata de cualquier punto de venta específico de ese local, así que no
// pueden coexistir como dos destinos separados sin duplicar el reparto.
export function destinosSuperpuestos(a: DestinoBasico, b: DestinoBasico): boolean {
  if (a.localId == null || b.localId == null || a.localId !== b.localId) return false;
  if (a.puntoDeVentaId === null || b.puntoDeVentaId === null) return true;
  return a.puntoDeVentaId === b.puntoDeVentaId;
}

// Devuelve el índice de la primera fila que se superpone con una fila
// anterior (ver destinosSuperpuestos), o null si no hay ninguna superposición.
export function encontrarDestinoDuplicado(destinos: DestinoBasico[]): number | null {
  for (let i = 0; i < destinos.length; i++) {
    if (destinos[i].localId == null) continue; // fila todavía sin completar, no es un duplicado real
    for (let j = 0; j < i; j++) {
      if (destinosSuperpuestos(destinos[i], destinos[j])) return i;
    }
  }
  return null;
}
