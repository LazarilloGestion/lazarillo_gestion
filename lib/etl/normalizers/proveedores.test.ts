import { describe, it, expect, vi } from "vitest";
import { normalizeProveedores } from "./proveedores";
import { createMockDb, mockAllExisting } from "../test-utils/mock-db";
import type { ETLRow } from "../types";

function baseRow(overrides: Partial<Record<string, unknown>> = {}): ETLRow {
  return {
    CODIGO: "PROV1",
    NOMBRE: "Proveedor Uno",
    RAZON: "Proveedor Uno SA",
    DIRECCION: "Calle 123",
    LOCALIDAD: "CABA",
    CONTACTO: "Juan",
    TELEFONO: "1122334455",
    FAX: "",
    CELULAR: "",
    TIPO_IVA: "RI",
    CUIT: "20-12345678-9",
    CBU: "",
    ALIASCBU: "",
    DIAS_VENC: 30,
    IVA: 1,
    IVA_DIF: 0,
    E_MAIL: "prov@test.com",
    OBSERVAC: "",
    DETPERC: "",
    ...overrides,
  };
}

describe("normalizeProveedores", () => {
  it("fila sin CODIGO se cuenta en skipped, no se inserta", async () => {
    const db = createMockDb();
    const res = await normalizeProveedores([baseRow({ CODIGO: null })], db);
    expect(res.skipped).toBe(1);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(0);
  });

  it("DIAS_VENC no numérico va a errors, no queda NaN en silencio", async () => {
    const db = createMockDb();
    const res = await normalizeProveedores([baseRow({ DIAS_VENC: "ERROR" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/DIAS_VENC/);
  });

  it("IVA con valor no booleano va a errors", async () => {
    const db = createMockDb();
    const res = await normalizeProveedores([baseRow({ IVA: "tal vez" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/IVA/);
  });

  it("cuenta created vs updated según si el codigo ya existe en la tabla", async () => {
    const dbCreated = createMockDb();
    const resCreated = await normalizeProveedores([baseRow()], dbCreated);
    expect(resCreated.created).toBe(1);
    expect(resCreated.updated).toBe(0);

    const proveedorModel = { findMany: vi.fn() };
    mockAllExisting(proveedorModel, "codigo");
    const dbUpdated = createMockDb({ proveedor: proveedorModel });
    const resUpdated = await normalizeProveedores([baseRow()], dbUpdated);
    expect(resUpdated.created).toBe(0);
    expect(resUpdated.updated).toBe(1);
  });

  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeProveedores([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });

  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 19) throw new Error("simulated batch failure");
      if (sql.values[0] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeProveedores(
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
