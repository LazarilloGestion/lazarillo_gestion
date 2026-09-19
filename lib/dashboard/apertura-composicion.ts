import type { ComposicionMes } from "./types";
import { normalizarTexto } from "../text-normalize";

type DecimalLike = number | string | { toString(): string };
const toNum = (x: DecimalLike): number =>
  typeof x === "object" && x !== null ? Number(x.toString()) : Number(x);

export type ComposicionSqlRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
  destino_nombre: string;
  pct: DecimalLike;
  importe_calculado: DecimalLike;
};

export type ComposicionOriginalRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
  importe_original: DecimalLike;
};

// Arma el mapa concepto -> mes -> { total (= 100%), destinos[] } que consume el
// tooltip de pivot-table. `total` viene de importe_original YA deduplicado por
// compra en SQL (ver app/api/dashboard/pivot/route.ts) — acá solo se suman las
// filas ya agregadas.
export function buildComposicion(
  destinoRows: ComposicionSqlRow[],
  originalRows: ComposicionOriginalRow[]
): Record<string, Record<number, ComposicionMes>> {
  const out: Record<string, Record<number, ComposicionMes>> = {};

  const ensure = (concepto: string, mes: number): ComposicionMes => {
    out[concepto] ??= {};
    out[concepto][mes] ??= { total: 0, destinos: [] };
    return out[concepto][mes];
  };

  for (const row of originalRows) {
    ensure(row.concepto_codigo, row.mes).total += toNum(row.importe_original);
  }
  for (const row of destinoRows) {
    const bucket = ensure(row.concepto_codigo, row.mes);
    const pct = toNum(row.pct);
    const importe = toNum(row.importe_calculado);
    // La SQL ahora particiona estas filas también por proveedor_id (para poder
    // alimentar buildComposicionPorProveedor) — acá se vuelven a fusionar por
    // (nombre, pct) para reproducir exactamente el agrupamiento que la propia
    // query hacía antes de esa partición (GROUP BY ..., destino_nombre, da.porcentaje).
    const existente = bucket.destinos.find((d) => d.nombre === row.destino_nombre && d.pct === pct);
    if (existente) {
      existente.importe += importe;
    } else {
      bucket.destinos.push({ nombre: row.destino_nombre, pct, importe });
    }
  }
  return out;
}

// Misma idea que buildComposicion, pero indexada también por proveedor: el
// tooltip de la vista "por Proveedor" necesita el reparto de ESE proveedor en
// ESE concepto, no el total cruzando todos los proveedores del concepto (que
// es lo que devuelve buildComposicion) — ver spec §3.3.
//
// Sin proveedor_id, la clave usa el texto crudo normalizado (mismo formato
// `texto:<normalizado>` que arma provKeyOriginal en pivot-por-proveedor.ts,
// para que el lookup por esa clave encuentre esta entrada) en vez de un
// sentinela fijo — así "Diego" y "GASTOS VARIOS" no comparten composición
// aunque ninguno tenga proveedor real (spec 2026-09-19-agrupar-sin-proveedor-por-texto-crudo-design.md §3.3).
export function buildComposicionPorProveedor(
  destinoRows: ComposicionSqlRow[],
  originalRows: ComposicionOriginalRow[]
): Record<string, Record<number, ComposicionMes>> {
  const out: Record<string, Record<number, ComposicionMes>> = {};

  const key = (concepto: string, proveedorId: number | null, proveedorNombre: string) =>
    `${concepto}|${proveedorId != null ? String(proveedorId) : `texto:${normalizarTexto(proveedorNombre)}`}`;

  const ensure = (concepto: string, proveedorId: number | null, proveedorNombre: string, mes: number): ComposicionMes => {
    const k = key(concepto, proveedorId, proveedorNombre);
    out[k] ??= {};
    out[k][mes] ??= { total: 0, destinos: [] };
    return out[k][mes];
  };

  for (const row of originalRows) {
    ensure(row.concepto_codigo, row.proveedor_id, row.proveedor_nombre, row.mes).total += toNum(row.importe_original);
  }
  // Misma fusión por (nombre, pct) que buildComposicion, por una razón
  // análoga: el GROUP BY de la SQL particiona también por proveedor_nombre,
  // pero la clave de este bucket usa proveedor_id cuando existe. Un proveedor
  // real cuyo maestro no tiene nombre NI razón hace que el COALESCE caiga a
  // c.proveedor (que varía fila a fila), fragmentando un mismo proveedor_id en
  // varias filas SQL que caen todas en este bucket — sin fusionar, el mismo
  // destino aparecería duplicado en el tooltip.
  for (const row of destinoRows) {
    const bucket = ensure(row.concepto_codigo, row.proveedor_id, row.proveedor_nombre, row.mes);
    const pct = toNum(row.pct);
    const importe = toNum(row.importe_calculado);
    const existente = bucket.destinos.find((d) => d.nombre === row.destino_nombre && d.pct === pct);
    if (existente) {
      existente.importe += importe;
    } else {
      bucket.destinos.push({ nombre: row.destino_nombre, pct, importe });
    }
  }
  return out;
}
