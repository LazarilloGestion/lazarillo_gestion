import { encontrarSuperposicion } from "@/lib/apertura/validaciones";
import type { ReglaVigencia } from "@/lib/apertura/vigencia";

// Concepto fijo por empleado (Diego 29/10/2026): todo lo cargado a nombre de un empleado (sueldo,
// adelanto, aguinaldo…) va a un concepto de caja — y por ende a su rubro. Mismos períodos que las
// reglas de apertura (histórico, entre fechas, en adelante, hacia atrás, con o sin extremos).
// Puro (lo usa también el cliente): sin Prisma.

export type ModoVigencia = ReglaVigencia["modo"];

export interface ReglaConceptoEmpleado {
  id: number;
  entidadId: string; // "texto:<nombre normalizado>|codigo:<código>" — el mismo de la apertura del empleado
  nombre: string | null;
  origenPuntoDeVentaId: number;
  conceptoCodigo: string;
  modo: ModoVigencia;
  fechaDesde: string | null; // ISO
  fechaHasta: string | null;
  extremosInclusivos: boolean;
}

const aDate = (s: string | null) => (s ? new Date(s) : null);

/** Falta una fecha que el modo exige → mensaje; si está todo bien, null. */
export function errorVigencia(r: { modo: ModoVigencia; fechaDesde: string | null; fechaHasta: string | null }): string | null {
  if ((r.modo === "entre_fechas" || r.modo === "desde_adelante") && !r.fechaDesde) return "Falta la fecha desde.";
  if ((r.modo === "entre_fechas" || r.modo === "desde_atras") && !r.fechaHasta) return "Falta la fecha hasta.";
  if (r.modo === "entre_fechas" && r.fechaDesde! > r.fechaHasta!) return "La fecha desde es posterior a la fecha hasta.";
  return null;
}

/** id de una regla activa del mismo empleado y PDV cuyo período se pisa con el de la nueva, o null. */
export function superposicion(nueva: Omit<ReglaConceptoEmpleado, "id" | "nombre" | "conceptoCodigo"> & { id?: number }, existentes: ReglaConceptoEmpleado[]): number | null {
  const mismas = existentes.filter((e) => e.entidadId === nueva.entidadId && e.origenPuntoDeVentaId === nueva.origenPuntoDeVentaId && e.id !== nueva.id);
  const v = (r: { modo: ModoVigencia; fechaDesde: string | null; fechaHasta: string | null; extremosInclusivos: boolean }): ReglaVigencia =>
    ({ modo: r.modo, fechaDesde: aDate(r.fechaDesde), fechaHasta: aDate(r.fechaHasta), extremosInclusivos: r.extremosInclusivos });
  return encontrarSuperposicion(v(nueva), mismas.map((e) => ({ ...v(e), id: e.id })));
}

/** Texto corto del período, como en las reglas de apertura. */
export function describirPeriodo(r: { modo: ModoVigencia; fechaDesde: string | null; fechaHasta: string | null }): string {
  const f = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
  switch (r.modo) {
    case "historico": return "todo el histórico";
    case "entre_fechas": return `${f(r.fechaDesde)} a ${f(r.fechaHasta)}`;
    case "desde_adelante": return `desde ${f(r.fechaDesde)}`;
    case "desde_atras": return `hasta ${f(r.fechaHasta)}`;
  }
}
