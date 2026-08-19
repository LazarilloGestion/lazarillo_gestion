import { describe, it, expect } from "vitest";
import {
  parseComprobanteFromDetalle,
  computeCompraRowId,
  compraIdentityFromRawRow,
  compraIdentityFromDbRecord,
} from "./compra-identity";
import type { ETLRow } from "../types";

describe("parseComprobanteFromDetalle", () => {
  it("parsea 'A 0606-00761530' al formato compacto con zero-padding", () => {
    expect(parseComprobanteFromDetalle("A 0606-00761530")).toBe("A060600761530");
  });

  it("aplica el alias TIC -> Z", () => {
    expect(parseComprobanteFromDetalle("TIC 0001-00000042")).toBe("Z000100000042");
  });

  it("devuelve null si no matchea el formato esperado", () => {
    expect(parseComprobanteFromDetalle("sin comprobante")).toBeNull();
    expect(parseComprobanteFromDetalle(null)).toBeNull();
  });
});

describe("computeCompraRowId", () => {
  it("con comprobante: dos inputs que solo difieren en importe dan el mismo rowId", () => {
    const base = {
      codCga: "GASTO1", fechaISO: "2026-03-15", codigo: "PROV1", concepto: "Alquiler",
      comprobante: "A060600761530", detalle: "A 0606-00761530", observacNormalizado: "Obs", importe: "1000",
    };
    const a = computeCompraRowId(base);
    const b = computeCompraRowId({ ...base, importe: "1200" });
    expect(a).toBe(b);
  });

  it("sin comprobante: dos inputs que solo difieren en importe dan rowId distinto", () => {
    const base = {
      codCga: "GASTO1", fechaISO: "2026-03-15", codigo: "PROV1", concepto: "Sueldos",
      comprobante: null, detalle: null, observacNormalizado: "Juan", importe: "1000",
    };
    const a = computeCompraRowId(base);
    const b = computeCompraRowId({ ...base, importe: "1200" });
    expect(a).not.toBe(b);
  });

  it("sin comprobante: dos inputs idénticos dan el mismo rowId (dedup real)", () => {
    const base = {
      codCga: "GASTO1", fechaISO: "2026-03-15", codigo: "PROV1", concepto: "Sueldos",
      comprobante: null, detalle: null, observacNormalizado: "Juan", importe: "1000",
    };
    expect(computeCompraRowId(base)).toBe(computeCompraRowId({ ...base }));
  });

  // Regresión: hallazgo real en producción (dry-run de la migración de rowId,
  // 19-ago-2026) — "Iva compensacion" reutiliza el mismo comprobante para dos
  // ajustes distintos del mismo período, distinguibles solo por OBSERVAC
  // (null vs "San Justo"). Sin OBSERVAC en el hash, colapsaban al mismo rowId.
  it("con comprobante: mismo comprobante pero OBSERVAC distinto (mismo comprobante reutilizado en dos ajustes reales) da rowId distinto", () => {
    const base = {
      codCga: "820", fechaISO: "2026-01-16", codigo: "17", concepto: "Iva compensacion",
      comprobante: "A000600003425", detalle: "A  0006-00003425", observacNormalizado: null, importe: "13830.96",
    };
    const a = computeCompraRowId(base);
    const b = computeCompraRowId({ ...base, observacNormalizado: "San Justo", importe: "79692.69" });
    expect(a).not.toBe(b);
  });

  // Regresión: hallazgo real — un "Tic" (ticket) no es un documento único como
  // una factura real, el mismo número de ticket se repite para compras
  // genuinamente distintas (dos compras de comida el mismo día, mismo Tic,
  // OBSERVAC null en ambas, solo IMPORTE distingue). Deben tratarse como sin
  // comprobante confiable — de lo contrario colapsan al mismo rowId.
  it("Tic (ticket): dos compras con el mismo Tic, mismo OBSERVAC (null) pero IMPORTE distinto dan rowId distinto (comprobante no confiable, cae a la rama sin comprobante)", () => {
    const base = {
      codCga: "988", fechaISO: "2026-06-19", codigo: "3721", concepto: "Cumple COMIDA",
      comprobante: null, // esComprobanteConfiable(detalle) ya descartó el comprobante derivado del Tic
      detalle: "Tic 1522-19062026", observacNormalizado: null, importe: "112000",
    };
    const a = computeCompraRowId(base);
    const b = computeCompraRowId({ ...base, importe: "75000" });
    expect(a).not.toBe(b);
  });
});

describe("compraIdentityFromRawRow / compraIdentityFromDbRecord — equivalencia", () => {
  // Esta es la propiedad que garantiza que reimportar el mismo archivo produce
  // el mismo rowId que el que la migración le asignó a la compra ya existente.
  it("con comprobante: identidad calculada desde la fila cruda == identidad calculada desde el registro ya persistido", () => {
    const rawRow: ETLRow = {
      COD_CGA: "GASTO1",
      FECHA: 45000, // serial Excel, ~2023-03-15
      CODIGO: "PROV1",
      CONCEPTO: "Alquiler",
      DETALLE: "A 0606-00761530",
      OBSERVAC: "observación   con   espacios",
      IMPORTE: 1000,
    };

    const dbRecord = {
      codCga: "GASTO1",
      fecha: new Date("2023-03-15"),
      codigo: "PROV1",
      concepto: "Alquiler",
      comprobante: "A060600761530",
      detalle: "A 0606-00761530",
      observac: "Observación Con Espacios", // ya normalizado por normalizeText al insertar
      importe: { toString: () => "1000" }, // shape de Prisma.Decimal
    };

    const fromRaw = computeCompraRowId(compraIdentityFromRawRow(rawRow));
    const fromDb = computeCompraRowId(compraIdentityFromDbRecord(dbRecord));
    expect(fromRaw).toBe(fromDb);
  });

  it("sin comprobante: identidad calculada desde la fila cruda == identidad calculada desde el registro ya persistido", () => {
    const rawRow: ETLRow = {
      COD_CGA: "GASTO2",
      FECHA: 45000,
      CODIGO: "EMP5",
      CONCEPTO: "Liquidacion Sueldo",
      DETALLE: null,
      OBSERVAC: "juan perez",
      IMPORTE: 250000,
    };

    const dbRecord = {
      codCga: "GASTO2",
      fecha: new Date("2023-03-15"),
      codigo: "EMP5",
      concepto: "Liquidacion Sueldo",
      comprobante: null,
      detalle: null,
      observac: "Juan Perez",
      importe: { toString: () => "250000" },
    };

    const fromRaw = computeCompraRowId(compraIdentityFromRawRow(rawRow));
    const fromDb = computeCompraRowId(compraIdentityFromDbRecord(dbRecord));
    expect(fromRaw).toBe(fromDb);
  });

  // Regresión: Prisma.Decimal#toString() elimina ceros finales al leer desde
  // la base ("1500.50" persistido vuelve como "1500.5"), mientras que la fila
  // cruda del Excel mantiene el string tal cual. Sin canonicalizar ambos
  // lados a través de Prisma.Decimal, este mismatch de formato hacía que
  // computeCompraRowId discrepara para el mismo importe — justo en las
  // compras sin comprobante, donde importe es parte del hash.
  it("sin comprobante: importe con distinto formato pero mismo valor (Excel '1500.50' vs Decimal#toString() '1500.5') da el mismo rowId", () => {
    const rawRow: ETLRow = {
      COD_CGA: "GASTO3",
      FECHA: 45000,
      CODIGO: "PROV9",
      CONCEPTO: "Gasto suelto",
      DETALLE: null,
      OBSERVAC: "sin comprobante",
      IMPORTE: "1500.50",
    };

    const dbRecord = {
      codCga: "GASTO3",
      fecha: new Date("2023-03-15"),
      codigo: "PROV9",
      concepto: "Gasto suelto",
      comprobante: null,
      detalle: null,
      observac: "Sin Comprobante",
      importe: { toString: () => "1500.5" }, // lo que devuelve Prisma.Decimal para ese mismo valor
    };

    const fromRaw = computeCompraRowId(compraIdentityFromRawRow(rawRow));
    const fromDb = computeCompraRowId(compraIdentityFromDbRecord(dbRecord));
    expect(fromRaw).toBe(fromDb);
  });

  it("Tic (ticket): compraIdentityFromRawRow y compraIdentityFromDbRecord coinciden en tratar el comprobante como no confiable (comprobante queda null pese a que DETALLE parsea)", () => {
    const rawRow: ETLRow = {
      COD_CGA: "988",
      FECHA: 45000, // serial Excel, ~2023-03-15 (mismo serial usado en los demás tests de este archivo)
      CODIGO: "3721",
      CONCEPTO: "Cumple COMIDA",
      DETALLE: "Tic 1522-19062026",
      OBSERVAC: null,
      IMPORTE: 112000,
    };

    const dbRecord = {
      codCga: "988",
      fecha: new Date("2023-03-15"),
      codigo: "3721",
      concepto: "Cumple COMIDA",
      comprobante: "Z152219062026", // valor real guardado en la columna (alias TIC -> Z, se sigue guardando igual)
      detalle: "Tic 1522-19062026",
      observac: null,
      importe: { toString: () => "112000" },
    };

    const fromRaw = compraIdentityFromRawRow(rawRow);
    const fromDb = compraIdentityFromDbRecord(dbRecord);
    expect(fromRaw.comprobante).toBeNull();
    expect(fromDb.comprobante).toBeNull();
    expect(computeCompraRowId(fromRaw)).toBe(computeCompraRowId(fromDb));
  });
});
