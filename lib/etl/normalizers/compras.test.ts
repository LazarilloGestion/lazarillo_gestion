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
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeCompras([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });

  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 21) throw new Error("simulated batch failure");
      if (sql.values[5] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeCompras(
      [baseRow({ CODIGO: "BAD", DETALLE: null, IMPORTE: 100 }), baseRow({ CODIGO: "OK", DETALLE: null, IMPORTE: 200 })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
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

    it("reconciliación exitosa pero el $executeRaw del mismo chunk falla: no reporta la reconciliación (el chunk entero terminó en error)", async () => {
      // Mismo criterio que el test de arriba "un fallo de $executeRaw se reporta
      // en errors sin lanzar excepción", pero con una reconciliación de por medio:
      // el rename (compra.update) sí corre y se resuelve OK, pero si el INSERT del
      // chunk falla después, comprasReconciliadas no debe reportar esa fila como
      // reconciliada — el chunk completo quedó en error, no en 0 created/updated
      // con una reconciliación "exitosa" fantasma.
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return [];
          return [huerfana()];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
      const res = await normalizeCompras([baseRow()], db);
      expect(compraModel.update).toHaveBeenCalledWith({
        where: { rowId: "huerfana-rowid" },
        data: { rowId: expect.any(String) },
      });
      expect(res.comprasReconciliadas).toEqual([]);
      expect(res.created).toBe(0);
      expect(res.updated).toBe(0);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].message).toMatch(/constraint violation/);
    });

    // Hallazgo Important #4 de la revisión final de rama, 29-sep-2026: la
    // reconciliación hacia adelante no tenía NINGUNA de las guardas de
    // seguridad del script de limpieza retroactiva (Task 5) — un par con la
    // forma real Mochila/Válvula (mismo comprobante, dos ítems reales
    // distintos de una misma factura) que llegara por un import EN VIVO se
    // fusionaba en silencio con cero chequeo. Ahora usa el mismo predicado
    // esReconciliacionSegura que el script — ver compra-identity.ts.
    it("fila nueva con 1 candidato por ancla pero comprobante compartido sin relación de prefijo (caso real Mochila/Válvula): NO fusiona, queda en reconciliacionesAmbiguas", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return [];
          // DETALLE default de baseRow() ("A 0606-00761530") parsea al mismo
          // comprobante "A060600761530" que la fila nueva de abajo produce.
          return [huerfana({
            rowId: "huerfana-valvula",
            comprobante: "A060600761530",
            detalle: "A 0606-00761530",
            observac: "Valvula + Tecla Descarga Baño",
          })];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const filaNueva = baseRow({ OBSERVAC: "Mochila Baño Vestuario" });
      const res = await normalizeCompras([filaNueva], db);
      expect(compraModel.update).not.toHaveBeenCalled();
      expect(res.created).toBe(1);
      expect(res.updated).toBe(0);
      expect(res.comprasReconciliadas).toEqual([]);
      expect(res.reconciliacionesAmbiguas).toHaveLength(1);
      expect(res.reconciliacionesAmbiguas[0].candidatos).toEqual(["huerfana-valvula"]);
    });

    // Hallazgo real, dry-run de scripts/reconciliar-duplicados-erp.ts contra
    // producción (29-sep-2026): comprobante null en AMBOS lados no es
    // evidencia de que sea la misma compra editada por el ERP — dos
    // transacciones genuinamente distintas sin comprobante (pagos a personas
    // distintas, mismo importe/día/centro de costo) pueden coincidir en el
    // ancla por casualidad. Antes de este fix, esReconciliacionSegura trataba
    // "cualquiera de los dos null" como seguro (saltaba todo chequeo de
    // texto), así que este candidato se fusionaba en silencio. Ver
    // compra-identity.ts, esReconciliacionSegura, motivo ambas_sin_comprobante.
    it("fila nueva con 1 candidato por ancla y comprobante null en AMBAS filas, OBSERVAC sin relación (caso real Sergio/Ricardo Profe Fc): NO fusiona, queda en reconciliacionesAmbiguas", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return [];
          return [huerfana({
            rowId: "huerfana-ricardo",
            detalle: null,
            comprobante: null,
            observac: "Ricardo Profe Fc",
          })];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const filaNueva = baseRow({ DETALLE: null, OBSERVAC: "Sergio Profe Fc" });
      const res = await normalizeCompras([filaNueva], db);
      expect(compraModel.update).not.toHaveBeenCalled();
      expect(res.created).toBe(1);
      expect(res.updated).toBe(0);
      expect(res.comprasReconciliadas).toEqual([]);
      expect(res.reconciliacionesAmbiguas).toHaveLength(1);
      expect(res.reconciliacionesAmbiguas[0].candidatos).toEqual(["huerfana-ricardo"]);
    });

    // Prueba directa de que el mecanismo 1 (reconciliación hacia adelante)
    // corta la causa raíz: reimportar el MISMO archivo sin cambios después de
    // que ya reconcilió una vez no debe volver a intentar reconciliar ni
    // crear una fila nueva — tiene que encontrar la fila (ya renombrada al
    // hash nuevo) por su propio hash y solo actualizarla. Sin este fix, la
    // reconciliación se dispararía en cada reimport porque la fila "vieja"
    // (rowId original) nunca deja de aparecer como huérfana.
    it("reimport tras reconciliar: la segunda importación (misma fila, sin cambios) encuentra la fila por su propio hash y actualiza, no vuelve a reconciliar", async () => {
      const huerfanaSeed = {
        rowId: "huerfana-rowid",
        esDistribuido: false,
        codCga: "GASTO1", concepto: "Alquiler", fecha: safeDate(45000), codigo: "PROV1",
        proveedor: "Juan Perez", detalle: null, comprobante: null, localId: null,
        observac: "Obs vieja",
        importe: { toString: () => "1000" }, impInt: { toString: () => "0" }, imputac: "X",
        per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
      };
      const tabla = new Map<string, typeof huerfanaSeed>([[huerfanaSeed.rowId, huerfanaSeed]]);

      const findMany = vi.fn(async (args: {
        where?: {
          rowId?: { in?: string[]; notIn?: string[] };
          codCga?: unknown; codigo?: unknown; concepto?: unknown;
          fecha?: Date; importe?: { toString(): string };
        };
      }) => {
        const where = args?.where ?? {};
        let filas = Array.from(tabla.values());
        if (where.rowId?.in) {
          const set = new Set(where.rowId.in);
          filas = filas.filter((f) => set.has(f.rowId));
        }
        if (where.rowId?.notIn) {
          const set = new Set(where.rowId.notIn);
          filas = filas.filter((f) => !set.has(f.rowId));
        }
        if (where.codCga !== undefined) filas = filas.filter((f) => f.codCga === where.codCga);
        if (where.codigo !== undefined) filas = filas.filter((f) => f.codigo === where.codigo);
        if (where.concepto !== undefined) filas = filas.filter((f) => f.concepto === where.concepto);
        if (where.fecha !== undefined) filas = filas.filter((f) => f.fecha?.getTime() === where.fecha!.getTime());
        if (where.importe !== undefined) filas = filas.filter((f) => f.importe.toString() === where.importe!.toString());
        return filas.map((f) => ({ ...f }));
      });
      const update = vi.fn(async (args: { where: { rowId: string }; data: Record<string, unknown> }) => {
        const existente = tabla.get(args.where.rowId);
        if (!existente) throw new Error(`no existe: ${args.where.rowId}`);
        tabla.delete(args.where.rowId);
        const actualizada = { ...existente, ...args.data } as typeof huerfanaSeed;
        tabla.set(actualizada.rowId, actualizada);
        return actualizada;
      });
      const db = createMockDb({ compra: { findMany, update } });

      const fila = baseRow(); // DETALLE default -> comprobante "A060600761530"
      const rowIdEsperado = computeCompraRowId(compraIdentityFromRawRow(fila));

      const primera = await normalizeCompras([fila], db);
      expect(primera.comprasReconciliadas).toEqual(["huerfana-rowid"]);
      expect(primera.created).toBe(0);
      expect(primera.updated).toBe(1);
      // La fila vieja ya no existe bajo su rowId original — quedó renombrada
      // al hash nuevo, que es justo el que la segunda importación va a
      // recomputar para la misma fila sin cambios.
      expect(tabla.has("huerfana-rowid")).toBe(false);
      expect(tabla.has(rowIdEsperado)).toBe(true);

      const segunda = await normalizeCompras([fila], db);
      expect(segunda.comprasReconciliadas).toEqual([]); // no vuelve a reconciliar
      expect(segunda.reconciliacionesAmbiguas).toEqual([]);
      expect(segunda.created).toBe(0);
      expect(segunda.updated).toBe(1); // encontrada de una por su propio hash
      expect(update).toHaveBeenCalledTimes(1); // solo el rename de la primera vez, no un segundo
    });

    // Hallazgo Important #3: la exclusión de candidatos de reconciliación
    // usaba solo el rowId del CHUNK actual (chunkRowIds), no de todo el
    // archivo. Con CHUNK_SIZE=500, una fila realmente huérfana (X, ya
    // existente en la base) que aparece SIN CAMBIOS en un chunk posterior
    // del mismo archivo podía ser "robada" por una fila de ancla compartida
    // (Y) que se procesa antes en un chunk anterior — porque, desde el punto
    // de vista de Y, X no parecía excluible (su chunkRowIds no la incluía).
    // El resultado real: la fila de Y termina pisando el lugar de X, y el
    // contenido real y distinto de X se pierde (o, según el orden, termina
    // creándose una fila de más) — ver comentario de rowIdsEnArchivo en
    // compras.ts para el detalle completo del mecanismo.
    it("frontera de chunk (CHUNK_SIZE=500): una fila huérfana real (X, en un chunk posterior) y una fila distinta que comparte su ancla (Y, en un chunk anterior) no se funden entre sí", async () => {
      const filaX = baseRow({
        COD_CGA: "GASTOX", CODIGO: "PROVX", CONCEPTO: "ConceptoX", FECHA: 45100,
        DETALLE: null, OBSERVAC: "Version Original", IMPORTE: 500,
      });
      const filaY = baseRow({
        COD_CGA: "GASTOX", CODIGO: "PROVX", CONCEPTO: "ConceptoX", FECHA: 45100,
        DETALLE: null, OBSERVAC: "Version Corregida", IMPORTE: 500,
      });
      const identidadX = compraIdentityFromRawRow(filaX);
      const rowIdX = computeCompraRowId(identidadX);

      const seedX = {
        rowId: rowIdX,
        esDistribuido: false,
        codCga: identidadX.codCga,
        concepto: identidadX.concepto,
        fecha: new Date(identidadX.fechaISO!),
        codigo: identidadX.codigo,
        proveedor: "Juan Perez",
        detalle: identidadX.detalle,
        comprobante: null,
        localId: null,
        observac: identidadX.observacNormalizado,
        importe: { toString: () => identidadX.importe! },
        impInt: { toString: () => "0" }, imputac: "X",
        per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
      };

      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: {
          where?: {
            rowId?: { in?: string[]; notIn?: string[] };
            codCga?: unknown; codigo?: unknown; concepto?: unknown;
            fecha?: Date; importe?: { toString(): string };
          };
        }) => {
          const where = args?.where ?? {};
          if (where.rowId?.in) {
            return where.rowId.in.includes(rowIdX) ? [seedX] : [];
          }
          const matchaAncla =
            where.codCga === seedX.codCga &&
            where.codigo === seedX.codigo &&
            where.concepto === seedX.concepto &&
            where.fecha?.getTime() === seedX.fecha.getTime() &&
            where.importe?.toString() === seedX.importe.toString();
          if (!matchaAncla) return [];
          const excluida = where.rowId?.notIn?.includes(rowIdX) ?? false;
          return excluida ? [] : [seedX];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });

      // X va primero (índice 0, cae en el chunk 1); 499 filas de relleno con
      // ancla propia y distinta; Y al final (índice 500, cae en el chunk 2)
      // — así se fuerza el corte real de CHUNK_SIZE=500 entre ambas.
      const relleno = Array.from({ length: 499 }, (_, i) =>
        baseRow({ CODIGO: `RELLENO${i}`, CONCEPTO: `Relleno ${i}`, OBSERVAC: `Relleno ${i}` })
      );
      const rows = [filaX, ...relleno, filaY];
      expect(rows.length).toBe(501);

      const res = await normalizeCompras(rows, db);

      expect(res.errors).toEqual([]);
      expect(compraModel.update).not.toHaveBeenCalled();
      expect(res.comprasReconciliadas).toEqual([]); // X no es huérfana: la encuentra su propio hash en su chunk.
      expect(res.updated).toBe(1); // filaX, match directo por hash
      expect(res.created).toBe(500); // 499 relleno + filaY (fila distinta, NO se funde con X)
    });

    it("dos filas en el mismo chunk: una reconcilia y su insert sobrevive el fallback, la otra falla — solo la exitosa se reporta como reconciliada", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] }; codigo?: unknown } }) => {
          if (args?.where?.rowId?.in) return []; // sin match exacto por hash para ninguna de las dos
          if (args?.where?.codigo === "PROV1") return [huerfana()]; // ancla de filaA (CODIGO default)
          return []; // filaB tiene ancla distinta, sin candidatos
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
        if (sql.values.length > 21) throw new Error("simulated batch failure");
        if (sql.values[5] === "BAD") throw new Error("valor fuera de rango numérico");
        return 1;
      });
      const filaA = baseRow(); // CODIGO "PROV1" (default) — matchea el ancla de huerfana()
      const filaB = baseRow({ CODIGO: "BAD", COD_CGA: "OTRO", CONCEPTO: "Otro concepto", DETALLE: null, IMPORTE: 999 });
      const res = await normalizeCompras([filaA, filaB], db);
      expect(compraModel.update).toHaveBeenCalledWith({
        where: { rowId: "huerfana-rowid" },
        data: { rowId: expect.any(String) },
      });
      expect(res.comprasReconciliadas).toEqual(["huerfana-rowid"]);
      expect(res.updated).toBe(1);
      expect(res.created).toBe(0);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    });
  });
});
