import { describe, it, expect, vi } from "vitest";
import { normalizeCompras } from "./compras";
import { createMockDb, mockAllExisting } from "../test-utils/mock-db";
import type { ETLRow } from "../types";

function baseRow(overrides: Partial<Record<string, unknown>> = {}): ETLRow {
  return {
    COD_CGA: "GASTO1",
    FECHA: 45000, // serial Excel — 2023-03-15 aprox.
    CODIGO: "PROV1",
    CONCEPTO: "Alquiler",
    DETALLE: "A 0606-00761530",
    PROVEEDOR: "Juan Perez",
    OBSERVAC: "obs",
    IMPORTE: 1000,
    IMP_INT: 0,
    IMPUTAC: "X",
    PER1: 0,
    PER2: 0,
    PER3: 0,
    ...overrides,
  };
}

describe("normalizeCompras", () => {
  it("fila sin COD_CGA/FECHA va a skippedRows con motivo sin_datos, no se inserta", async () => {
    const db = createMockDb();
    const res = await normalizeCompras([baseRow({ COD_CGA: null })], db);
    expect(res.created).toBe(0);
    expect(res.skippedRows).toHaveLength(1);
    expect(res.skippedRows[0].motivo).toBe("sin_datos");
    expect(res.errors).toHaveLength(0);
  });

  it("IMPORTE no numérico (celda con contenido corrupto) va a errors, no queda null en silencio", async () => {
    const db = createMockDb();
    const res = await normalizeCompras([baseRow({ IMPORTE: "ERROR" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/IMPORTE/);
  });

  it("FECHA presente pero no parseable va a errors, no queda null en silencio", async () => {
    const db = createMockDb();
    const res = await normalizeCompras([baseRow({ FECHA: "no-es-fecha" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/FECHA/);
  });

  it("dos filas con hash idéntico (duplicado real): una se inserta, la otra queda en skippedRows motivo duplicado", async () => {
    const db = createMockDb();
    const res = await normalizeCompras([baseRow(), baseRow()], db);
    expect(res.created).toBe(1);
    expect(res.skippedRows).toHaveLength(1);
    expect(res.skippedRows[0].motivo).toBe("duplicado");
  });

  it("dos filas iguales salvo IMPORTE (transacciones genuinamente distintas): ambas se insertan", async () => {
    const db = createMockDb();
    const res = await normalizeCompras([baseRow({ IMPORTE: 100 }), baseRow({ IMPORTE: 200 })], db);
    expect(res.created).toBe(2);
    expect(res.skippedRows.filter((s) => s.motivo === "duplicado")).toHaveLength(0);
  });

  it("resuelve proveedorId consultando proveedores por CODIGO", async () => {
    const proveedorModel = { findMany: vi.fn().mockResolvedValue([{ id: 5, codigo: "PROV1" }]) };
    const db = createMockDb({ proveedor: proveedorModel });
    const res = await normalizeCompras([baseRow({ CODIGO: "PROV1" })], db);
    expect(proveedorModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { codigo: { in: ["PROV1"] } } })
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(0);
  });

  it("conceptoCodigo queda null (no revienta) cuando el código no existe en conceptos_caja", async () => {
    const conceptoModel = { findMany: vi.fn().mockResolvedValue([]) };
    const db = createMockDb({ conceptoCaja: conceptoModel });
    const res = await normalizeCompras([baseRow({ COD_CGA: "NOEXISTE" })], db);
    expect(conceptoModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { codigo: { in: ["NOEXISTE"] } } })
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(0);
  });

  it("cuenta created vs updated según si el rowId ya existe en la tabla", async () => {
    const dbCreated = createMockDb();
    const resCreated = await normalizeCompras([baseRow()], dbCreated);
    expect(resCreated.created).toBe(1);
    expect(resCreated.updated).toBe(0);

    const compraModel = { findMany: vi.fn() };
    mockAllExisting(compraModel, "rowId");
    const dbUpdated = createMockDb({ compra: compraModel });
    const resUpdated = await normalizeCompras([baseRow()], dbUpdated);
    expect(resUpdated.created).toBe(0);
    expect(resUpdated.updated).toBe(1);
  });

  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("constraint violation"));
    const res = await normalizeCompras([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });

  it("sanity check: toda fila del archivo termina en exactamente un bucket (creada/actualizada/omitida/error)", async () => {
    const rows = [
      baseRow(), // ok → created
      baseRow({ COD_CGA: null }), // sin_datos
      baseRow({ IMPORTE: "ERROR" }), // error
      baseRow(), // duplicado de la primera
    ];
    const db = createMockDb();
    const res = await normalizeCompras(rows, db);
    expect(res.created + res.updated + res.skippedRows.length + res.errors.length).toBe(rows.length);
  });
});
