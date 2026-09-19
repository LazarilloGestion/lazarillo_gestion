import { describe, it, expect, vi } from "vitest";
import { normalizeCompras } from "./compras";
import { createMockDb, mockAllExisting } from "../test-utils/mock-db";
import type { ETLRow } from "../types";
import { excelDateToISO, safeDate } from "../helpers";

function baseRow(overrides: Partial<Record<string, unknown>> = {}): ETLRow {
  return {
    COD_CGA: "GASTO1",
    FECHA: 45000, // serial Excel — 2023-03-15 aprox.
    CODIGO: "PROV1",
    CONCEPTO: "Alquiler",
    DETALLE: "A 0606-00761530",
    PROVEEDOR: "Juan Perez",
    OBSERVAC: "Obs",
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

  it("sin comprobante: dos filas iguales salvo IMPORTE (transacciones genuinamente distintas): ambas se insertan", async () => {
    // DETALLE: null — sin comprobante parseable, IMPORTE es parte de la identidad
    // (a diferencia del caso con comprobante, ver compra-identity.ts). Antes este
    // test usaba el DETALLE default de baseRow() (que sí es un comprobante válido),
    // lo cual dejó de ser válido tras la identidad partida: con comprobante presente,
    // IMPORTE ya no distingue transacciones (CA-12).
    const db = createMockDb();
    const res = await normalizeCompras([baseRow({ DETALLE: null, IMPORTE: 100 }), baseRow({ DETALLE: null, IMPORTE: 200 })], db);
    expect(res.created).toBe(2);
    expect(res.skippedRows.filter((s) => s.motivo === "duplicado")).toHaveLength(0);
  });

  // Índice 16 = columna "proveedorId" en el INSERT de compras.ts (20 columnas por fila,
  // mismo criterio de introspección de $executeRaw que ventas.test.ts:91-92).

  it("resuelve proveedorId cuando el texto crudo coincide con el nombre del proveedor", async () => {
    const proveedorModel = {
      findMany: vi.fn().mockResolvedValue([{ id: 5, codigo: "PROV1", nombre: "Juan Perez", razon: null }]),
    };
    const db = createMockDb({ proveedor: proveedorModel });
    const res = await normalizeCompras([baseRow({ CODIGO: "PROV1", PROVEEDOR: "Juan Perez" })], db);
    expect(proveedorModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { codigo: { in: ["PROV1"] } },
        select: { id: true, codigo: true, nombre: true, razon: true },
      })
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(0);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    expect(call.values[16]).toBe(5); // columna proveedorId
  });

  it("CODIGO coincide con un proveedor real pero el texto crudo no matchea (cruce, ver bug Diego/Creacion Tm Sr): proveedorId queda null", async () => {
    const proveedorModel = {
      findMany: vi.fn().mockResolvedValue([{ id: 46893, codigo: "309", nombre: "Creacion Tm Sr", razon: null }]),
    };
    const db = createMockDb({ proveedor: proveedorModel });
    const res = await normalizeCompras(
      [baseRow({ CODIGO: "309", PROVEEDOR: "Diego", COD_CGA: "307", CONCEPTO: "B. Liquidacion De Sueldo" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(0);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    expect(call.values[16]).toBeNull();
  });

  it("PROVEEDOR null en la fila: sin texto para contradecir, se mantiene el proveedorId resuelto por código", async () => {
    const proveedorModel = {
      findMany: vi.fn().mockResolvedValue([{ id: 7, codigo: "PROV1", nombre: "Cualquiera", razon: null }]),
    };
    const db = createMockDb({ proveedor: proveedorModel });
    const res = await normalizeCompras([baseRow({ CODIGO: "PROV1", PROVEEDOR: null })], db);
    expect(res.created).toBe(1);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    expect(call.values[16]).toBe(7);
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

  it("con comprobante: dos filas con el mismo comprobante pero IMPORTE distinto son el mismo registro (mismo rowId) — se dedupean, no se insertan como transacciones distintas", async () => {
    // Nota: no se testea vía dos llamadas separadas a normalizeCompras() con
    // mockAllExisting simulando "reimport" — mockAllExisting hace eco de
    // CUALQUIER rowId consultado como "ya existente" sin comparar valores, así
    // que ese approach da created=0/updated=1 sin importar qué hashee makeRowId
    // (no discrimina la lógica bajo prueba). En cambio, dos filas con el MISMO
    // comprobante en un solo batch sólo colapsan a un rowId si la identidad
    // compartida ignora IMPORTE — igual que el test de "duplicado real" de
    // arriba, pero cruzando IMPORTE distinto para aislar específicamente el
    // comportamiento de compra-identity.ts con comprobante presente.
    const db = createMockDb();
    const res = await normalizeCompras(
      [baseRow({ DETALLE: "A 0606-00761530", IMPORTE: 1000 }), baseRow({ DETALLE: "A 0606-00761530", IMPORTE: 5000 })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.skippedRows.filter((s) => s.motivo === "duplicado")).toHaveLength(1);
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

  it("compra existente esDistribuido=true con importe idéntico → comprasDistribuidasModificadas vacío", async () => {
    const fechaEsperada = safeDate(45000);
    const db = createMockDb({
      compra: {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          const ids = args?.where?.rowId?.in ?? [];
          return ids.map((rowId) => ({
            rowId,
            esDistribuido: true,
            codCga: "GASTO1", concepto: "Alquiler", fecha: fechaEsperada,
            codigo: "PROV1", proveedor: "Juan Perez", detalle: "A 0606-00761530", observac: "Obs",
            importe: { toString: () => "1000" }, impInt: { toString: () => "0" }, imputac: "X",
            per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
          }));
        }),
      },
    });
    const res = await normalizeCompras([baseRow()], db);
    expect(res.comprasDistribuidasModificadas).toEqual([]);
  });

  it("compra existente esDistribuido=true con importe distinto → aparece en comprasDistribuidasModificadas", async () => {
    const fechaEsperada = new Date(excelDateToISO(45000)!);
    const db = createMockDb({
      compra: {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          const ids = args?.where?.rowId?.in ?? [];
          return ids.map((rowId) => ({
            rowId,
            esDistribuido: true,
            codCga: "GASTO1", concepto: "Alquiler", fecha: fechaEsperada,
            codigo: "PROV1", proveedor: "Juan Perez", detalle: "A 0606-00761530", observac: "Obs",
            importe: { toString: () => "1000" }, impInt: { toString: () => "0" }, imputac: "X",
            per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
          }));
        }),
      },
    });
    const res = await normalizeCompras([baseRow({ IMPORTE: 1200 })], db);
    expect(res.comprasDistribuidasModificadas).toHaveLength(1);
  });

  it("compra existente esDistribuido=false → nunca entra a comprasDistribuidasModificadas aunque cambie el importe", async () => {
    const fechaEsperada = new Date(excelDateToISO(45000)!);
    const db = createMockDb({
      compra: {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          const ids = args?.where?.rowId?.in ?? [];
          return ids.map((rowId) => ({
            rowId,
            esDistribuido: false,
            codCga: "GASTO1", concepto: "Alquiler", fecha: fechaEsperada,
            codigo: "PROV1", proveedor: "Juan Perez", detalle: "A 0606-00761530", observac: "Obs",
            importe: { toString: () => "1000" }, impInt: { toString: () => "0" }, imputac: "X",
            per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
          }));
        }),
      },
    });
    const res = await normalizeCompras([baseRow({ IMPORTE: 1200 })], db);
    expect(res.comprasDistribuidasModificadas).toEqual([]);
  });

  it("compra nueva (no existía) → nunca entra a comprasDistribuidasModificadas", async () => {
    const db = createMockDb(); // findMany devuelve [] por defecto — nada existe
    const res = await normalizeCompras([baseRow()], db);
    expect(res.comprasDistribuidasModificadas).toEqual([]);
  });
});
