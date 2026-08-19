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
});
