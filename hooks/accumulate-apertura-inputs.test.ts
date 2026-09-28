import { describe, it, expect } from "vitest";
import { accumulateAperturaInputs } from "./accumulate-apertura-inputs";
import type { ETLReport } from "@/lib/etl/types";

function report(overrides: Partial<ETLReport> = {}): ETLReport {
  return {
    fileType: "proveedores",
    totalRows: 10,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    durationMs: 100,
    ...overrides,
  };
}

describe("accumulateAperturaInputs", () => {
  it("sin reportes de compras -> huboComprasTocadas false, lista vacía", () => {
    const result = accumulateAperturaInputs([report({ fileType: "proveedores", created: 5 })]);
    expect(result.huboComprasTocadas).toBe(false);
    expect(result.comprasModificadas).toEqual([]);
  });

  it("compras con created>0 -> huboComprasTocadas true", () => {
    const result = accumulateAperturaInputs([report({ fileType: "compras", created: 3, updated: 0 })]);
    expect(result.huboComprasTocadas).toBe(true);
  });

  it("compras con updated>0 -> huboComprasTocadas true", () => {
    const result = accumulateAperturaInputs([report({ fileType: "compras", created: 0, updated: 7 })]);
    expect(result.huboComprasTocadas).toBe(true);
  });

  it("compras sin created ni updated -> huboComprasTocadas false", () => {
    const result = accumulateAperturaInputs([report({ fileType: "compras", created: 0, updated: 0 })]);
    expect(result.huboComprasTocadas).toBe(false);
  });

  it("acumula comprasDistribuidasModificadas de varios reportes de distintas tandas", () => {
    const result = accumulateAperturaInputs([
      report({ fileType: "compras", created: 1, comprasDistribuidasModificadas: ["a", "b"] }),
      report({ fileType: "detalleCompras" }),
      report({ fileType: "compras", created: 1, comprasDistribuidasModificadas: ["c"] }),
    ]);
    expect(result.comprasModificadas).toEqual(["a", "b", "c"]);
    expect(result.huboComprasTocadas).toBe(true);
  });

  it("reporte de compras sin comprasDistribuidasModificadas no rompe la acumulación", () => {
    const result = accumulateAperturaInputs([report({ fileType: "compras", created: 1 })]);
    expect(result.comprasModificadas).toEqual([]);
    expect(result.huboComprasTocadas).toBe(true);
  });

  it("array vacío -> ambos valores en su estado neutro", () => {
    const result = accumulateAperturaInputs([]);
    expect(result.huboComprasTocadas).toBe(false);
    expect(result.comprasModificadas).toEqual([]);
  });
});
