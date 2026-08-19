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
function canonicalDecimal(raw: string | null): string | null {
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
