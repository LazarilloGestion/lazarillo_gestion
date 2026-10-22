import { describe, it, expect } from "vitest";
import { excelDateToISO, safeDate } from "./helpers";
import { normalizeCompras } from "./normalizers/compras";
import { createMockDb } from "./test-utils/mock-db";
import type { ETLRow } from "./types";

describe("fechas imposibles del ERP", () => {
  it("excelDateToISO devuelve null en vez de reventar", () => {
    expect(excelDateToISO(-601570)).toBeNull();
    expect(excelDateToISO(0)).toBeNull();
    expect(excelDateToISO(Number.NaN)).toBeNull();
    expect(safeDate(-601570)).toBeNull();
    expect(excelDateToISO(45660)).toBe("2025-01-03");
  });

  it("una fila del 14 con FECHA rota va a errors y el resto se importa", async () => {
    const base: ETLRow = {
      COD_CGA: 914, CONCEPTO: "Adelanto Sueldo", FECHA: 45660, CODIGO: 414, PROVEEDOR: "Martin",
      DETALLE: "", OBSERVAC: "NANO CAFE", IMPORTE: 5500, IMP_INT: 0, IMPUTAC: "", PER1: 0, PER2: 0, PER3: 0,
    };
    const rota = { ...base, FECHA: -601570, OBSERVAC: "FECHA ROTA" };
    const res = await normalizeCompras([base, rota], createMockDb(), { localId: 1, puntoDeVentaId: 1 });
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/FECHA/);
    expect(res.errors[0].fila).toBe(3);
  });
});
