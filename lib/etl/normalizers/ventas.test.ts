import { describe, it, expect, vi } from "vitest";
import { normalizeVentas } from "./ventas";
import { createMockDb, mockAllExisting } from "../test-utils/mock-db";
import type { ETLRow } from "../types";

function baseRow(overrides: Partial<Record<string, unknown>> = {}): ETLRow {
  return {
    TURNO: "1",
    COMPROBANT: "0001",
    HORA: "20:00",
    TIPO: "Mesa",
    MESA: "5",
    MOZO: "Juan",
    CUB: "4",
    COBRO: "Efectivo",
    COD_COBRO: "EF",
    IMPORTE: 500,
    TOTAL: 500,
    DESCUENTO: 0,
    CLINOMBRE: "Cliente",
    CLIRAZON: "",
    CLICUIT: "",
    FECHA: 45000,
    COD_SUC: "1",
    NOMBRESUC: "Sucursal",
    CUPON: "",
    ...overrides,
  };
}

describe("normalizeVentas", () => {
  it("fila con TURNO y COD_COBRO ambos vacíos (encabezado de totales) va a skippedRows sin_datos", async () => {
    const db = createMockDb();
    const res = await normalizeVentas([baseRow({ TURNO: null, COD_COBRO: null })], db);
    expect(res.created).toBe(0);
    expect(res.skippedRows).toHaveLength(1);
    expect(res.skippedRows[0].motivo).toBe("sin_datos");
  });

  it("IMPORTE no numérico va a errors, no queda null en silencio", async () => {
    const db = createMockDb();
    const res = await normalizeVentas([baseRow({ IMPORTE: "ERROR" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/IMPORTE/);
  });

  it("FECHA presente pero no parseable va a errors (aunque FECHA sea opcional en ventas)", async () => {
    const db = createMockDb();
    const res = await normalizeVentas([baseRow({ FECHA: "no-es-fecha" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/FECHA/);
  });

  it("FECHA vacía es válida (filas secundarias de pago partido)", async () => {
    const db = createMockDb();
    const res = await normalizeVentas([baseRow({ FECHA: null })], db);
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(0);
  });

  it("dos filas con hash idéntico (duplicado real): una se inserta, la otra queda en skippedRows motivo duplicado", async () => {
    const db = createMockDb();
    const res = await normalizeVentas([baseRow(), baseRow()], db);
    expect(res.created).toBe(1);
    expect(res.skippedRows).toHaveLength(1);
    expect(res.skippedRows[0].motivo).toBe("duplicado");
  });

  it("dos filas iguales salvo IMPORTE (transacciones genuinamente distintas): ambas se insertan", async () => {
    const db = createMockDb();
    const res = await normalizeVentas([baseRow({ IMPORTE: 100 }), baseRow({ IMPORTE: 200 })], db);
    expect(res.created).toBe(2);
    expect(res.skippedRows.filter((s) => s.motivo === "duplicado")).toHaveLength(0);
  });

  it("fillPartialRows: fila secundaria de pago partido hereda TURNO/COMPROBANT/etc. de la fila anterior", async () => {
    const db = createMockDb();
    const rows = [
      baseRow(),
      baseRow({
        TURNO: null, COMPROBANT: null, HORA: null, TIPO: null, MESA: null, MOZO: null,
        COD_SUC: null, NOMBRESUC: null, COD_COBRO: "TARJETA", COBRO: "Tarjeta", IMPORTE: 300,
      }),
    ];
    const res = await normalizeVentas(rows, db);
    expect(res.created).toBe(2);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    const COLUMNS_PER_ROW = 23;
    // índice 1 de cada bloque de 23 valores = columna "turno"
    expect(call.values[COLUMNS_PER_ROW + 1]).toBe("1");
  });

  it("cuenta created vs updated según si el rowId ya existe en la tabla", async () => {
    const dbCreated = createMockDb();
    const resCreated = await normalizeVentas([baseRow()], dbCreated);
    expect(resCreated.created).toBe(1);
    expect(resCreated.updated).toBe(0);

    const ventaModel = { findMany: vi.fn() };
    mockAllExisting(ventaModel, "rowId");
    const dbUpdated = createMockDb({ venta: ventaModel });
    const resUpdated = await normalizeVentas([baseRow()], dbUpdated);
    expect(resUpdated.created).toBe(0);
    expect(resUpdated.updated).toBe(1);
  });

  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeVentas([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });

  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 23) throw new Error("simulated batch failure");
      if (sql.values[2] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeVentas(
      [baseRow({ COMPROBANT: "BAD", TURNO: "1" }), baseRow({ COMPROBANT: "OK", TURNO: "2" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    expect(res.errors[0].rowIndex).toBe(0);
  });

  it("sanity check: toda fila del archivo termina en exactamente un bucket (creada/actualizada/omitida/error)", async () => {
    const rows = [
      baseRow(),
      baseRow({ TURNO: null, COD_COBRO: null }), // sin_datos
      baseRow({ IMPORTE: "ERROR" }), // error
      baseRow(), // duplicado de la primera
    ];
    const db = createMockDb();
    const res = await normalizeVentas(rows, db);
    expect(res.created + res.updated + res.skippedRows.length + res.errors.length).toBe(rows.length);
  });
});
