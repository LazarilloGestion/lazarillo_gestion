import { describe, it, expect, vi } from "vitest";
import { normalizeRubrosArticulo } from "./rubros-articulo";
import { createMockDb, mockAllExisting } from "../test-utils/mock-db";
import type { ETLRow } from "../types";

function baseRow(overrides: Partial<Record<string, unknown>> = {}): ETLRow {
  return {
    CODIGO: "RA1",
    NOMBRE: "Rubro Articulo Uno",
    COLOR: "Rojo",
    GRUPO_NRO: "1",
    GRUPO_COL: "1",
    GRUPO_FOT: "1",
    EXCLUYEINF: 0,
    EVENTO: "",
    DELIACT: 1,
    EVE_FOR: "",
    EVE_FORM: "",
    EVE_FORMH: "",
    DISCONT: 0,
    FECHA_UPDA: 45000,
    MODO_VISTA: "G",
    ...overrides,
  };
}

describe("normalizeRubrosArticulo", () => {
  it("fila sin CODIGO se cuenta en skipped, no se inserta", async () => {
    const db = createMockDb();
    const res = await normalizeRubrosArticulo([baseRow({ CODIGO: null })], db);
    expect(res.skipped).toBe(1);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(0);
  });

  it("EXCLUYEINF con valor no booleano va a errors", async () => {
    const db = createMockDb();
    const res = await normalizeRubrosArticulo([baseRow({ EXCLUYEINF: "tal vez" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/EXCLUYEINF/);
  });

  it("DISCONT no numérico va a errors", async () => {
    const db = createMockDb();
    const res = await normalizeRubrosArticulo([baseRow({ DISCONT: "ERROR" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/DISCONT/);
  });

  it("cuenta created vs updated según si el codigo ya existe en la tabla", async () => {
    const dbCreated = createMockDb();
    const resCreated = await normalizeRubrosArticulo([baseRow()], dbCreated);
    expect(resCreated.created).toBe(1);
    expect(resCreated.updated).toBe(0);

    const rubroArtModel = { findMany: vi.fn() };
    mockAllExisting(rubroArtModel, "codigo");
    const dbUpdated = createMockDb({ rubroArticulo: rubroArtModel });
    const resUpdated = await normalizeRubrosArticulo([baseRow()], dbUpdated);
    expect(resUpdated.created).toBe(0);
    expect(resUpdated.updated).toBe(1);
  });

  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("constraint violation"));
    const res = await normalizeRubrosArticulo([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });
});
