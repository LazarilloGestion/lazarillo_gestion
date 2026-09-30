import { describe, it, expect, vi } from "vitest";
import { normalizeArticulos } from "./articulos";
import { createMockDb, mockAllExisting } from "../test-utils/mock-db";
import type { ETLRow } from "../types";

function baseRow(overrides: Partial<Record<string, unknown>> = {}): ETLRow {
  return {
    CODIGO: "ART1",
    NOMBRE: "Articulo Uno",
    PRECIO1: 100,
    PRECIO2: 110,
    PRECIO3: 120,
    PRECIO4: 130,
    COD_RUA: 5,
    COD_SUA: 0,
    ...overrides,
  };
}

describe("normalizeArticulos", () => {
  it("fila sin CODIGO se cuenta en skipped, no se inserta", async () => {
    const db = createMockDb();
    const res = await normalizeArticulos([baseRow({ CODIGO: null })], db);
    expect(res.skipped).toBe(1);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(0);
  });

  it("PRECIO1 no numérico va a errors, no queda null en silencio", async () => {
    const db = createMockDb();
    const res = await normalizeArticulos([baseRow({ PRECIO1: "ERROR" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/PRECIO1/);
  });

  it("COD_RUA no numérico va a errors en vez de resolverse a null en silencio", async () => {
    const db = createMockDb();
    const res = await normalizeArticulos([baseRow({ COD_RUA: "ERROR" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/COD_RUA/);
  });

  it("cuenta created vs updated según si el codigo ya existe en la tabla", async () => {
    const dbCreated = createMockDb();
    const resCreated = await normalizeArticulos([baseRow()], dbCreated);
    expect(resCreated.created).toBe(1);
    expect(resCreated.updated).toBe(0);

    const articuloModel = { findMany: vi.fn() };
    mockAllExisting(articuloModel, "codigo");
    const dbUpdated = createMockDb({ articulo: articuloModel });
    const resUpdated = await normalizeArticulos([baseRow()], dbUpdated);
    expect(resUpdated.created).toBe(0);
    expect(resUpdated.updated).toBe(1);
  });

  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeArticulos([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });

  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 8) throw new Error("simulated batch failure");
      if (sql.values[0] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeArticulos(
      [baseRow({ CODIGO: "OK" }), baseRow({ CODIGO: "BAD" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    expect(res.errors[0].rowIndex).toBe(1);
    expect(res.errors[0].rawCodigo).toBe("BAD");
  });
});
