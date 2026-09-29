import { describe, it, expect, vi } from "vitest";
import { normalizeCompras } from "./compras";
import { createMockDb, mockAllExisting } from "../test-utils/mock-db";
import type { ETLRow } from "../types";
import { excelDateToISO, safeDate } from "../helpers";
import { computeCompraRowId, compraIdentityFromRawRow } from "./compra-identity";

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

  // Índice 16 = columna "proveedorId" en el INSERT de compras.ts; índice 20 =
  // "proveedorTextoNormalizado" (21 columnas por fila), mismo criterio de
  // introspección de $executeRaw que ventas.test.ts:91-92.

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

  it("proveedorId null: proveedorTextoNormalizado usa el texto crudo normalizado", async () => {
    const db = createMockDb();
    const res = await normalizeCompras([baseRow({ CODIGO: null, PROVEEDOR: "Diego" })], db);
    expect(res.created).toBe(1);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    expect(call.values[16]).toBeNull(); // proveedorId
    expect(call.values[20]).toBe("diego"); // proveedorTextoNormalizado
  });

  it("proveedorId null y sin texto de proveedor: proveedorTextoNormalizado cae a 'Sin Proveedor' normalizado", async () => {
    const db = createMockDb();
    const res = await normalizeCompras([baseRow({ CODIGO: null, PROVEEDOR: null })], db);
    expect(res.created).toBe(1);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    expect(call.values[20]).toBe("sinproveedor");
  });

  it("proveedorId resuelto (no null): proveedorTextoNormalizado queda null, no se calcula", async () => {
    const proveedorModel = {
      findMany: vi.fn().mockResolvedValue([{ id: 5, codigo: "PROV1", nombre: "Juan Perez", razon: null }]),
    };
    const db = createMockDb({ proveedor: proveedorModel });
    const res = await normalizeCompras([baseRow({ CODIGO: "PROV1", PROVEEDOR: "Juan Perez" })], db);
    expect(res.created).toBe(1);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    expect(call.values[16]).toBe(5); // proveedorId
    expect(call.values[20]).toBeNull(); // proveedorTextoNormalizado
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

  describe("reconciliación de identidad (ERP edita comprobante/observac post-carga)", () => {
    function huerfana(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        rowId: "huerfana-rowid",
        esDistribuido: false,
        codCga: "GASTO1", concepto: "Alquiler", fecha: safeDate(45000), codigo: "PROV1",
        proveedor: "Juan Perez", detalle: null, observac: "Obs vieja",
        importe: { toString: () => "1000" }, impInt: { toString: () => "0" }, imputac: "X",
        per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
        ...overrides,
      };
    }

    it("fila nueva sin candidatos de reconciliación: se crea normal, no reconcilia", async () => {
      const db = createMockDb();
      const res = await normalizeCompras([baseRow()], db);
      expect(res.created).toBe(1);
      expect(res.comprasReconciliadas).toEqual([]);
      expect(res.reconciliacionesAmbiguas).toEqual([]);
    });

    it("fila nueva que matchea el ancla de una huérfana existente: reconcilia (rename) en vez de crear", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return []; // sin match exacto por hash
          return [huerfana()]; // match por ancla
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const res = await normalizeCompras([baseRow()], db);
      expect(res.created).toBe(0);
      expect(res.updated).toBe(1);
      expect(res.comprasReconciliadas).toEqual(["huerfana-rowid"]);
      expect(compraModel.update).toHaveBeenCalledWith({
        where: { rowId: "huerfana-rowid" },
        data: { rowId: expect.any(String) },
      });
    });

    it("fila nueva con 2+ candidatos por el mismo ancla: no fusiona (ambiguo), se crea normal y queda reportado", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return [];
          return [huerfana({ rowId: "huerfana-1" }), huerfana({ rowId: "huerfana-2" })];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const res = await normalizeCompras([baseRow()], db);
      expect(res.created).toBe(1);
      expect(compraModel.update).not.toHaveBeenCalled();
      expect(res.reconciliacionesAmbiguas).toHaveLength(1);
      expect(res.reconciliacionesAmbiguas[0].candidatos.sort()).toEqual(["huerfana-1", "huerfana-2"]);
    });

    it("huérfana reconciliada con esDistribuido=true y campos ERP distintos: aparece también en comprasDistribuidasModificadas", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return [];
          return [huerfana({ rowId: "huerfana-distribuida", esDistribuido: true })];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const filaNueva = baseRow({ DETALLE: "A 0606-00761530" });
      const res = await normalizeCompras([filaNueva], db);
      expect(res.comprasReconciliadas).toEqual(["huerfana-distribuida"]);
      // NO es "huerfana-distribuida": distribuciones_apertura.compraRowId tiene
      // ON UPDATE CASCADE hacia compras.rowId (migración
      // 20260819141156_apertura_gastos_schema), así que el rename de arriba ya
      // dejó a esa fila de distribuciones_apertura apuntando al rowId NUEVO
      // antes de que termine este normalizeCompras. sincronizarTrasImport
      // (lib/apertura/reimportacion.ts) busca por ese id en comprasModificadas
      // después del cascade — si acá se reportara el rowId viejo, esa búsqueda
      // no encontraría nada y la reversión de la distribución nunca correría.
      const rowIdNuevo = computeCompraRowId(compraIdentityFromRawRow(filaNueva));
      expect(res.comprasDistribuidasModificadas).toEqual([rowIdNuevo]);
    });

    it("importe nulo en la fila: no intenta reconciliar (sin evidencia de este caso, ver spec)", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return [];
          return [huerfana()];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const res = await normalizeCompras([baseRow({ IMPORTE: null })], db);
      expect(compraModel.update).not.toHaveBeenCalled();
      expect(res.comprasReconciliadas).toEqual([]);
    });
  });
});
