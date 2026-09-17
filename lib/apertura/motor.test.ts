import { describe, it, expect } from "vitest";
import { compararPrioridadNivel } from "./motor";

describe("compararPrioridadNivel", () => {
  it("registro va antes que proveedor", () => {
    expect(compararPrioridadNivel({ nivel: "registro" }, { nivel: "proveedor" })).toBeLessThan(0);
  });
  it("proveedor va antes que concepto", () => {
    expect(compararPrioridadNivel({ nivel: "proveedor" }, { nivel: "concepto" })).toBeLessThan(0);
  });
  it("registro va antes que concepto", () => {
    expect(compararPrioridadNivel({ nivel: "registro" }, { nivel: "concepto" })).toBeLessThan(0);
  });
  it("mismo nivel es equivalente", () => {
    expect(compararPrioridadNivel({ nivel: "concepto" }, { nivel: "concepto" })).toBe(0);
  });
});
