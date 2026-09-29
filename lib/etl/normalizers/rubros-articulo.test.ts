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

  it("DISCONT no numérico ni booleano va a errors", async () => {
    const db = createMockDb();
    const res = await normalizeRubrosArticulo([baseRow({ DISCONT: "ERROR" })], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/DISCONT/);
  });

  // El ERP exporta DISCONT (flag "discontinuado") como booleano real, no como decimal
  // — a pesar de que la columna en Prisma es Decimal? (legado, write-only, nunca se lee
  // en ningún otro lugar de la app). Detectado en producción 24-ago-2026: el 100% de las
  // filas de un reimport real fallaban porque el Excel trae DISCONT como `false`/`true`.
  it("DISCONT booleano (false/true) se acepta y no genera error", async () => {
    const db = createMockDb();
    const res = await normalizeRubrosArticulo([baseRow({ DISCONT: false })], db);
    expect(res.errors).toHaveLength(0);
    expect(res.created).toBe(1);
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
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeRubrosArticulo([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });

  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 15) throw new Error("simulated batch failure");
      if (sql.values[0] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeRubrosArticulo(
      [baseRow({ CODIGO: "BAD" }), baseRow({ CODIGO: "OK" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    expect(res.errors[0].rowIndex).toBe(0);
  });
});
