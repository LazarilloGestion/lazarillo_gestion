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

  // Con fecha, dos filas idénticas son dos cobros reales y se guardan las dos (ver más abajo);
  // las secundarias de pago partido (sin fecha) siguen deduplicándose como antes.
  it("dos filas secundarias (sin fecha) con hash idéntico: una se inserta, la otra queda en skippedRows motivo duplicado", async () => {
    const db = createMockDb();
    const res = await normalizeVentas([baseRow({ FECHA: null }), baseRow({ FECHA: null })], db);
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

describe("ventas: nunca duplicar (misma venta con otro rowId en la base)", () => {
  it("reusa el rowId de la venta que ya está con los mismos datos y la actualiza en vez de crear otra", async () => {
    const venta = {
      findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] }; fecha?: unknown } }) => {
        if (args?.where?.fecha) return [{ rowId: "viejo123", turno: "1", comprobant: "0001", codCobro: "EF", cobro: "Efectivo", importe: "500.000000", cupon: null, fecha: new Date("2023-03-15T00:00:00.000Z") }];
        return (args?.where?.rowId?.in ?? []).filter((id) => id === "viejo123").map((rowId) => ({ rowId }));
      }),
    };
    const db = createMockDb({ venta });
    const res = await normalizeVentas([baseRow({ COMPROBANT: "  0001 ", COBRO: "Efectivo   " })], db, { localId: 1, puntoDeVentaId: 1 } as never);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(1);
  });

  it("sin coincidencia crea normal; y dos ventas iguales del archivo no se pisan con el mismo rowId viejo", async () => {
    const venta = {
      findMany: vi.fn().mockImplementation(async (args: { where?: { fecha?: unknown } }) =>
        args?.where?.fecha ? [{ rowId: "viejo123", turno: "1", comprobant: "0001", codCobro: "EF", cobro: "Efectivo", importe: 500, cupon: "", fecha: new Date("2023-03-15T00:00:00.000Z") }] : []),
    };
    const db = createMockDb({ venta });
    const res = await normalizeVentas([baseRow({ COMPROBANT: "0002" }), baseRow({ COMPROBANT: "0001" })], db, { localId: 1, puntoDeVentaId: 1 } as never);
    expect(res.created + res.updated).toBe(2);
  });
});

describe("ventas: el archivo manda en sus días", () => {
  it("dos cobros idénticos en el mismo ticket se guardan los dos (no se pisan)", async () => {
    const db = createMockDb();
    const res = await normalizeVentas([baseRow(), baseRow()], db, { localId: 1, puntoDeVentaId: 1 } as never);
    expect(res.created).toBe(2);
    expect(res.skippedRows.filter((s) => s.motivo === "duplicado")).toHaveLength(0);
  });

  it("quita la venta que está en la base en esos días y ya no vino (anulada/cambiada en MaxiRest), salvo si tiene importe a mano", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const venta = {
      findMany: vi.fn().mockImplementation(async (args: { where?: { fecha?: unknown }; select?: Record<string, boolean> }) => {
        if (!args?.where?.fecha) return [];
        if (args.select?.importeManual) return [{ rowId: "fantasma", importeManual: null }, { rowId: "editada", importeManual: "100" }];
        return [];
      }),
      deleteMany,
    };
    const db = createMockDb({ venta } as never);
    const res = await normalizeVentas([baseRow()], db, { localId: 1, puntoDeVentaId: 1 } as never);
    expect(deleteMany).toHaveBeenCalledWith({ where: { rowId: { in: ["fantasma"] } } });
    expect(res.ventasQuitadas).toBe(1);
  });

  it("si sobran más de 200 no borra nada y avisa", async () => {
    const deleteMany = vi.fn();
    const venta = {
      findMany: vi.fn().mockImplementation(async (args: { where?: { fecha?: unknown }; select?: Record<string, boolean> }) =>
        args?.where?.fecha && args.select?.importeManual ? Array.from({ length: 201 }, (_, i) => ({ rowId: `x${i}`, importeManual: null })) : []),
      deleteMany,
    };
    const db = createMockDb({ venta } as never);
    const res = await normalizeVentas([baseRow()], db, { localId: 1, puntoDeVentaId: 1 } as never);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(res.errors[0].message).toMatch(/201 ventas/);
  });
});

describe("ventas: las cargadas a mano no se tocan al importar", () => {
  it("no quita una venta manual (man-…) aunque no venga en el archivo", async () => {
    const deleteMany = vi.fn();
    const venta = {
      findMany: vi.fn().mockImplementation(async (args: { where?: { fecha?: unknown }; select?: Record<string, boolean> }) =>
        args?.where?.fecha ? [{ rowId: "man-123", importeManual: null, turno: null, comprobant: "0001", codCobro: "MAN", cobro: null, importe: 500, cupon: null, fecha: new Date("2023-03-15T00:00:00.000Z") }] : []),
      deleteMany,
    };
    const db = createMockDb({ venta } as never);
    const res = await normalizeVentas([baseRow()], db, { localId: 1, puntoDeVentaId: 1 } as never);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(res.created).toBe(1);
  });
});
