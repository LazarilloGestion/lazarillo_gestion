import { describe, it, expect, vi } from "vitest";
import { normalizeDetalleCompras } from "./detalle-compras";
import { createMockDb, mockAllExisting } from "../test-utils/mock-db";
import type { ETLRow } from "../types";

function baseRow(overrides: Partial<Record<string, unknown>> = {}): ETLRow {
  return {
    COD_CPB: "FC",
    CODIGO: "ART1",
    COD_PRO: "PROV1",
    NUMERO1: "1",
    NUMERO2: "1",
    FECHA: 45000,
    NOMBRE: "Articulo Uno",
    MEDIDA: "UN",
    CANTIDAD: 10,
    NETO: 1000,
    TOTALINS: 1210,
    IVATOT: 210,
    IMPINTTOT: 0,
    TASA: 21,
    IVA: 21,
    IMP_INT: 0,
    PERCEP: 0,
    OBSERVAC: "obs",
    ...overrides,
  };
}

describe("normalizeDetalleCompras", () => {
  it("fila sin COD_CPB/CODIGO va a skippedRows con motivo sin_datos", async () => {
    const db = createMockDb();
    const res = await normalizeDetalleCompras([baseRow({ CODIGO: null })], db);
    expect(res.created).toBe(0);
    expect(res.skippedRows).toHaveLength(1);
    expect(res.skippedRows[0].motivo).toBe("sin_datos");
  });

  it("NETO no numérico va a errors, no queda null en silencio", async () => {
    const db = createMockDb();
    const res = await normalizeDetalleCompras([baseRow({ NETO: "ERROR" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/NETO/);
  });

  it("FECHA presente pero no parseable va a errors", async () => {
    const db = createMockDb();
    const res = await normalizeDetalleCompras([baseRow({ FECHA: "no-es-fecha" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/FECHA/);
  });

  it("FECHA vacía es válida (no es identificador acá)", async () => {
    const db = createMockDb();
    const res = await normalizeDetalleCompras([baseRow({ FECHA: null })], db);
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(0);
  });

  it("dos filas con hash idéntico (duplicado real): una se inserta, la otra queda en skippedRows motivo duplicado", async () => {
    const db = createMockDb();
    const res = await normalizeDetalleCompras([baseRow(), baseRow()], db);
    expect(res.created).toBe(1);
    expect(res.skippedRows).toHaveLength(1);
    expect(res.skippedRows[0].motivo).toBe("duplicado");
  });

  it("dos filas iguales salvo NETO (líneas genuinamente distintas): ambas se insertan", async () => {
    const db = createMockDb();
    const res = await normalizeDetalleCompras([baseRow({ NETO: 100 }), baseRow({ NETO: 200 })], db);
    expect(res.created).toBe(2);
    expect(res.skippedRows.filter((s) => s.motivo === "duplicado")).toHaveLength(0);
  });

  it("resuelve articuloCodigo consultando articulos por CODIGO", async () => {
    const articuloModel = { findMany: vi.fn().mockResolvedValue([{ codigo: "ART1" }]) };
    const db = createMockDb({ articulo: articuloModel });
    const res = await normalizeDetalleCompras([baseRow({ CODIGO: "ART1" })], db);
    expect(articuloModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { codigo: { in: ["ART1"] } } })
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(0);
  });

  it("cuenta created vs updated según si el rowId ya existe en la tabla", async () => {
    const dbCreated = createMockDb();
    const resCreated = await normalizeDetalleCompras([baseRow()], dbCreated);
    expect(resCreated.created).toBe(1);
    expect(resCreated.updated).toBe(0);

    const detalleModel = { findMany: vi.fn() };
    mockAllExisting(detalleModel, "rowId");
    const dbUpdated = createMockDb({ detalleCompra: detalleModel });
    const resUpdated = await normalizeDetalleCompras([baseRow()], dbUpdated);
    expect(resUpdated.created).toBe(0);
    expect(resUpdated.updated).toBe(1);
  });

  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("constraint violation"));
    const res = await normalizeDetalleCompras([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });

  it("sanity check: toda fila del archivo termina en exactamente un bucket (creada/actualizada/omitida/error)", async () => {
    const rows = [
      baseRow(),
      baseRow({ CODIGO: null }), // sin_datos
      baseRow({ NETO: "ERROR" }), // error
      baseRow(), // duplicado de la primera
    ];
    const db = createMockDb();
    const res = await normalizeDetalleCompras(rows, db);
    expect(res.created + res.updated + res.skippedRows.length + res.errors.length).toBe(rows.length);
  });
});
