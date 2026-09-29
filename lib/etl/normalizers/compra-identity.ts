import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { trim, normalizeText, excelDateToISO, toDecimalStr } from "../helpers";
import type { ETLRow } from "../types";

// Normaliza un importe ya convertido a string decimal a través de
// Prisma.Decimal, así "1500.50" (fila cruda del Excel) y "1500.5" (lo que
// devuelve Prisma.Decimal#toString() al leer el mismo valor desde la base)
// producen el mismo string canónico — sin esto, computeCompraRowId podía
// discrepar entre compraIdentityFromRawRow y compraIdentityFromDbRecord para
// el mismo importe con formato distinto (riesgo real solo en las compras
// sin comprobante, donde importe entra al hash).
export function canonicalDecimal(raw: string | null): string | null {
  if (raw == null) return null;
  try {
    return new Prisma.Decimal(raw).toString();
  } catch {
    return raw; // no debería pasar para un valor que ya pasó toDecimalStr, pero este módulo nunca debe tirar
  }
}

// Códigos del ERP en compras que difieren del COD_CPB en detalle_compras.
const CODE_ALIASES: Record<string, string> = {
  TIC: "Z",
};

// Convierte "A 0606-00761530" → "A060600761530" (mismo formato que detalle_compras.comprobante)
export function parseComprobanteFromDetalle(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const match = s.match(/^(\S+)\s+(\d+)-(\d+)$/);
  if (!match) return null;
  const [, cod, num1, num2] = match;
  const normalizedCod = CODE_ALIASES[cod.toUpperCase()] ?? cod.toUpperCase();
  return normalizedCod + num1.padStart(4, "0") + num2.padStart(8, "0");
}

// Un "Tic" (ticket) no es un documento único como una factura real — el mismo
// número de ticket puede repetirse para compras genuinamente distintas el
// mismo día (hallazgo real en datos de producción: dos compras de catering
// con el mismo Tic y distinto importe/observación). No se considera
// comprobante confiable para identidad — solo afecta qué rama de
// computeCompraRowId se usa; el valor aliasado (TIC -> Z) se sigue guardando
// tal cual en la columna `comprobante` para vincular con detalle_compras
// (parseComprobanteFromDetalle sigue igual, esto no lo toca).
function esComprobanteConfiable(detalleRaw: unknown): boolean {
  return !/^tic\s/i.test(String(detalleRaw ?? "").trim());
}

export interface CompraIdentityInput {
  codCga: string | null;
  fechaISO: string | null; // YYYY-MM-DD, canónico entre fila cruda y registro persistido
  codigo: string | null;
  concepto: string | null;
  comprobante: string | null;
  detalle: string | null;
  observacNormalizado: string | null;
  importe: string | null; // decimal como string, anti-drift de punto flotante
}

// Identidad partida: si hay comprobante parseable y confiable (documento real
// del ERP), el hash NO incluye importe — un cambio de importe para el mismo
// comprobante debe tratarse como actualización del mismo registro, no como
// transacción nueva (spec Apertura de Gastos, sección 10 / CA-12). Se incluye
// OBSERVAC igual: un mismo número de comprobante puede repetirse legítimamente
// entre compras distintas (hallazgo real: "Iva compensacion" reutiliza el
// comprobante de la factura que referencia para cada ajuste; una factura con
// múltiples ítems puede registrarse como varias compras con el mismo
// comprobante) — OBSERVAC es lo que las distingue en esos casos reales.
// Sin comprobante confiable (~40% de las filas: sueldos, alquiler, gastos
// sueltos, tickets) no hay forma de distinguir una corrección de una
// transacción distinta con los mismos campos descriptivos, así que se
// preserva el comportamiento anterior con IMPORTE incluido en el hash.
export function computeCompraRowId(input: CompraIdentityInput): string {
  const keyParts = input.comprobante
    ? [input.codCga, input.fechaISO, input.codigo, input.concepto, input.comprobante, input.observacNormalizado]
    : [input.codCga, input.fechaISO, input.codigo, input.concepto, input.detalle, input.observacNormalizado, input.importe];
  const key = keyParts.map((v) => v ?? "").join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

// Adaptador para una fila cruda del Excel del ERP (ETL en vivo). Los campos se
// normalizan igual que lo hace compraRowSchema (trim/normalizeText) para que el
// resultado sea idéntico al de compraIdentityFromDbRecord sobre el mismo dato ya
// persistido — es la propiedad que garantiza que reimportar el mismo archivo
// actualiza el registro existente en vez de crear uno nuevo.
export function compraIdentityFromRawRow(r: ETLRow): CompraIdentityInput {
  return {
    codCga: trim(r["COD_CGA"]),
    fechaISO: excelDateToISO(r["FECHA"]),
    codigo: trim(r["CODIGO"]),
    concepto: trim(r["CONCEPTO"]),
    comprobante: esComprobanteConfiable(r["DETALLE"]) ? parseComprobanteFromDetalle(r["DETALLE"]) : null,
    detalle: trim(r["DETALLE"]),
    observacNormalizado: normalizeText(r["OBSERVAC"]),
    importe: canonicalDecimal(toDecimalStr(r["IMPORTE"])),
  };
}

export interface CompraDbIdentitySource {
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  comprobante: string | null;
  detalle: string | null;
  observac: string | null;
  importe: { toString(): string } | null; // shape de Prisma.Decimal
}

// Adaptador para una compra ya persistida (usado por el script de migración de
// rowId). fecha se recompone a ISO desde el Date almacenado — safeDate() en el
// ETL siempre construye el Date a partir de un string 'YYYY-MM-DD' (medianoche
// UTC), así que toISOString().slice(0,10) reconstruye el mismo string exacto.
export function compraIdentityFromDbRecord(c: CompraDbIdentitySource): CompraIdentityInput {
  return {
    codCga: c.codCga,
    fechaISO: c.fecha ? c.fecha.toISOString().slice(0, 10) : null,
    codigo: c.codigo,
    concepto: c.concepto,
    comprobante: esComprobanteConfiable(c.detalle) ? c.comprobante : null,
    detalle: c.detalle,
    observacNormalizado: c.observac,
    importe: canonicalDecimal(c.importe != null ? c.importe.toString() : null),
  };
}

export interface CompraAnchor {
  codCga: string | null;
  fechaISO: string | null;
  codigo: string | null;
  concepto: string | null;
  importe: string | null;
}

// Subconjunto estable de CompraIdentityInput usado para reconciliar una fila
// "nueva" (hash de computeCompraRowId sin match) contra una fila existente
// que sea la misma compra real editada por el ERP después de la carga
// inicial — ver docs/superpowers/specs/2026-09-29-reconciliacion-identidad-
// compras-design.md. Deliberadamente NO incluye comprobante/detalle/
// observacNormalizado: son justamente los campos que el ERP edita post-carga
// (comprobante que aparece, observación que se corrige) y por eso rompen el
// hash de computeCompraRowId sin ser, en los hechos, una transacción nueva.
export function computeCompraAnchor(input: CompraIdentityInput): CompraAnchor {
  return {
    codCga: input.codCga,
    fechaISO: input.fechaISO,
    codigo: input.codigo,
    concepto: input.concepto,
    importe: input.importe,
  };
}

// Decide si una fila "nueva" debe reconciliarse con una de las filas
// existentes que comparten su ancla. Exactamente 1 candidato -> se
// reconcilia con esa. 0 candidatos -> nada que reconciliar (se maneja antes
// de llamar a esta función). 2+ candidatos -> ambiguo, no se fusiona (evita
// el caso real de una factura con más de un ítem que coincide en ancla —
// ver spec, caso "mochila/válvula").
export function pickReconciliationCandidate<T extends { rowId: string }>(candidatos: T[]): T | null {
  return candidatos.length === 1 ? candidatos[0] : null;
}

// "Relación de prefijo": el observac más corto de las dos filas es un
// prefijo textual del más largo — señal de que el ERP amplió/corrigió la
// misma descripción en vez de tratarse de dos compras reales distintas que
// comparten comprobante por casualidad (caso Mochila/Válvula, spec §1).
// Nota: un observac vacío/null del lado más corto pasa trivialmente
// ("".startsWith(...) siempre da true) — no se bloquea acá porque el
// llamador (esReconciliacionSegura) solo usa esta función cuando ya hay
// comprobante compartido, una señal real por sí sola.
function tienenRelacionDePrefijo(obsA: string | null, obsB: string | null): boolean {
  const a = obsA ?? "";
  const b = obsB ?? "";
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  return largo.startsWith(corto);
}

export interface DatosSeguridadReconciliacion {
  comprobante: string | null;
  observac: string | null;
  localId: number | null;
}

export type ResultadoSeguridadReconciliacion =
  | { segura: true }
  | { segura: false; motivo: "comprobantes_distintos" | "sin_relacion_de_prefijo" | "localId_distinto" };

// Predicado único compartido entre la reconciliación hacia adelante (import
// en vivo, ver normalizeCompras en compras.ts) y la limpieza retroactiva
// (scripts/reconciliar-duplicados-erp.ts) — ambas rutas fusionan/borran
// compras que comparten ancla (computeCompraAnchor) y ambas necesitan el
// MISMO criterio de seguridad para no confundir dos compras reales
// distintas con la misma compra editada por el ERP (hallazgo Critical +
// Important de la revisión final de rama, 29-sep-2026):
//
// 1) Ambas filas con comprobante no nulo pero DISTINTO -> nunca es la misma
//    compra real (ninguno de los dos mecanismos de este feature — comprobante
//    que aparece después, observac que se corrige — produce dos comprobantes
//    no nulos distintos para la misma compra real). Insegura siempre, sin
//    importar esDistribuido ni el texto de observac.
// 2) Ambas filas con el MISMO comprobante no nulo -> exige relación de
//    prefijo entre observac (caso Mochila/Válvula: mismo comprobante, dos
//    ítems reales distintos de una misma factura).
// 3) Cualquier otro caso con comprobante (incluido "uno de los dos es null",
//    el caso "comprobante aparece después" — el más inequívoco del diseño)
//    no se bloquea por este chequeo.
// 4) localId conocido de ambos lados y distinto -> insegura (hallazgo real:
//    ERPs de distintos locales pueden reusar código de proveedor/concepto
//    para negocios no relacionados — ver memoria del proyecto, incidente
//    Alta Nuñez-Comercio).
export function esReconciliacionSegura(
  a: DatosSeguridadReconciliacion,
  b: DatosSeguridadReconciliacion
): ResultadoSeguridadReconciliacion {
  if (a.comprobante != null && b.comprobante != null) {
    if (a.comprobante !== b.comprobante) {
      return { segura: false, motivo: "comprobantes_distintos" };
    }
    if (!tienenRelacionDePrefijo(a.observac, b.observac)) {
      return { segura: false, motivo: "sin_relacion_de_prefijo" };
    }
  }
  if (a.localId != null && b.localId != null && a.localId !== b.localId) {
    return { segura: false, motivo: "localId_distinto" };
  }
  return { segura: true };
}
