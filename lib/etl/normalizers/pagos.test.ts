import { describe, it, expect } from "vitest";
import { normalizePagos, makeComprobantePago, claveIdentidadPago, makePagoRowId, codigoONull } from "./pagos";
import { createMockDb, mockAllExisting } from "../test-utils/mock-db";
import { detectFileType } from "../detect-file-type";
import type { ETLRow } from "../types";

// Fila real del 80 del Bar (valores tal cual los lee SheetJS: fechas como serial).
function baseRow(overrides: Partial<Record<string, unknown>> = {}): ETLRow {
  return {
    FECHA: 45660,
    COD_CPB: "A",
    PREFIJO: 3,
    NUMERO: 76701,
    COD_PRO: 165,
    NOM_PRO: "PEHUENIA                      ",
    TOTAL: 109275.64,
    COD_CGA: 0,
    NOM_CGA: "                              ",
    COD_RGA: 0,
    NOM_RGA: "                              ",
    COD_CTG: 0,
    NOM_CTG: "                              ",
    PAGO: "BANCOS                        ",
    IMPORTE: 109275.64,
    FECHA_PAGO: 46026,
    ORDEN: 528,
    NUMERO_VAL: 0,
    COD_BAN: 0,
    NOM_BAN: "                              ",
    IMP_VAL: 0,
    ...overrides,
  };
}

const HEADERS_80 = ["FECHA", "COD_CPB", "PREFIJO", "NUMERO", "COD_PRO", "NOM_PRO", "TOTAL", "COD_CGA", "NOM_CGA", "COD_RGA", "NOM_RGA", "COD_CTG", "NOM_CTG", "PAGO", "IMPORTE", "FECHA_PAGO", "ORDEN", "FECHA_VAL", "NUMERO_VAL", "COD_BAN", "NOM_BAN", "IMP_VAL"];
const HEADERS_14 = ["COD_CGA", "CONCEPTO", "FECHA", "CODIGO", "PROVEEDOR", "DETALLE", "OBSERVAC", "IMPORTE", "IMP_INT", "IMPUTAC", "PER1", "PER2", "PER3"];
const HEADERS_25 = ["COD_PRO", "COD_CPB", "NUMERO1", "NUMERO2", "FECHA", "CODIGO", "NOMBRE", "MEDIDA", "CANTIDAD", "NETO", "TOTALINS", "IVATOT", "IMPINTTOT", "TASA", "IVA", "IMP_INT", "PERCEP", "OBSERVAC", "COD_CGA", "NOM_CGA"];

function sqlDe(db: ReturnType<typeof createMockDb>): string {
  const call = (db.$executeRaw as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { sql: string; values: unknown[] };
  return call.sql + " || " + JSON.stringify(call.values);
}

describe("detectFileType — informe 80", () => {
  it("reconoce el 80 como pagos y no confunde el 14 ni el 25 (con COD_CGA nuevo)", () => {
    expect(detectFileType(HEADERS_80)).toBe("pagos");
    expect(detectFileType(HEADERS_14)).toBe("compras");
    expect(detectFileType(HEADERS_25)).toBe("detalleCompras");
  });
});

describe("helpers de pagos", () => {
  it("arma el comprobante con el mismo formato que compras (COD + prefijo 4 + número 8)", () => {
    expect(makeComprobantePago("A", 3, 76701)).toBe("A000300076701");
    expect(makeComprobantePago("Z", 1145, 4012025)).toBe("Z114504012025");
    expect(makeComprobantePago("P", 0, 1296)).toBe("P000000001296");
    expect(makeComprobantePago("", 1, 2)).toBeNull();
  });

  it("'0' y vacío son 'no aplica' en los códigos", () => {
    expect(codigoONull(0)).toBeNull();
    expect(codigoONull("0")).toBeNull();
    expect(codigoONull("   ")).toBeNull();
    expect(codigoONull(899)).toBe("899");
  });

  it("la clave de identidad es estable y no depende del nombre del proveedor", () => {
    const a = claveIdentidadPago(baseRow());
    const b = claveIdentidadPago(baseRow({ NOM_PRO: "Pehuenia SRL" }));
    expect(a).toBe(b);
    expect(a).toBe("2026-01-04|528|A000300076701|165|109275.64|BANCOS|");
    expect(makePagoRowId(a, 1)).not.toBe(makePagoRowId(a, 2));
  });
});

describe("normalizePagos", () => {
  it("fila sin COD_CPB o sin FECHA_PAGO va a skippedRows como sin_datos, con la fila completa", async () => {
    const db = createMockDb();
    const res = await normalizePagos([baseRow({ COD_CPB: null }), baseRow({ FECHA_PAGO: null })], db);
    expect(res.created).toBe(0);
    expect(res.skippedRows).toHaveLength(2);
    expect(res.skippedRows[0].motivo).toBe("sin_datos");
    expect(res.skippedRows[0].fila).toBe(2);
    expect(res.skippedRows[0].columnas?.NOM_PRO?.trim()).toBe("PEHUENIA");
  });

  it("IMPORTE no numérico o FECHA_PAGO corrupta van a errors", async () => {
    const db = createMockDb();
    const res = await normalizePagos([baseRow({ IMPORTE: "abc" }), baseRow({ FECHA_PAGO: "no-fecha" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(2);
    expect(res.errors[0].message).toMatch(/IMPORTE/);
    expect(res.errors[1].message).toMatch(/FECHA_PAGO/);
  });

  it("inserta con comprobante, códigos '0' como null, local/PDV del contexto", async () => {
    const db = createMockDb();
    const res = await normalizePagos([baseRow()], db, { localId: 1, puntoDeVentaId: 1 });
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(0);
    const sql = sqlDe(db);
    expect(sql).toContain("INSERT INTO pagos");
    expect(sql).toContain('"A000300076701"');
    expect(sql).toContain('"Bancos"'); // PAGO normalizado
    // COD_CGA=0 / COD_BAN=0 / NUMERO_VAL=0 → null
    const values = (db.$executeRaw as unknown as { mock: { calls: { values: unknown[] }[][] } }).mock.calls[0][0].values;
    expect(values.filter((v) => v === null).length).toBeGreaterThanOrEqual(3);
    expect(values).toContain(1); // localId / secuencia
  });

  it("filas idénticas (cuotas iguales de la misma orden) se conservan todas con secuencia 1..n", async () => {
    const db = createMockDb();
    const cuota = baseRow({ COD_CPB: "Z", PREFIJO: 1428, NUMERO: 14042026, TOTAL: 4500000, IMPORTE: 750000, ORDEN: 1579, PAGO: "CAJA MAYOR" });
    const res = await normalizePagos([cuota, cuota, cuota, cuota, cuota, cuota], db, { localId: 1, puntoDeVentaId: 1 });
    expect(res.created).toBe(6);
    expect(res.skipped).toBe(0);
    const values = (db.$executeRaw as unknown as { mock: { calls: { values: unknown[] }[][] } }).mock.calls[0][0].values;
    const secuencias = [1, 2, 3, 4, 5, 6].filter((n) => values.includes(n));
    expect(secuencias).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reimportar el mismo archivo cuenta como updated, no crea duplicados", async () => {
    const db = createMockDb();
    mockAllExisting((db as unknown as { pago: { findMany: ReturnType<typeof import("vitest").vi.fn> } }).pago, "rowId");
    const res = await normalizePagos([baseRow(), baseRow()], db);
    expect(res.updated).toBe(2);
    expect(res.created).toBe(0);
  });

  it("resuelve proveedorId por código cuando el nombre coincide con el maestro", async () => {
    const db = createMockDb();
    (db.proveedor.findMany as unknown as ReturnType<typeof import("vitest").vi.fn>).mockResolvedValue([
      { id: 77, codigo: "165", nombre: "Pehuenia", razon: null },
    ]);
    await normalizePagos([baseRow()], db);
    const values = (db.$executeRaw as unknown as { mock: { calls: { values: unknown[] }[][] } }).mock.calls[0][0].values;
    expect(values).toContain(77);
  });

  it("si el lote falla, aísla la fila mala en errors y no pierde las demás", async () => {
    const db = createMockDb();
    const exec = db.$executeRaw as unknown as ReturnType<typeof import("vitest").vi.fn>;
    exec.mockRejectedValueOnce(new Error("lote")).mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("fila mala"));
    const res = await normalizePagos([baseRow(), baseRow({ ORDEN: 999 })], db);
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].rawCodigo).toBe("999");
    expect(res.errors[0].fila).toBe(3);
  });
});
