import { describe, it, expect } from "vitest";
import { esConceptoFeriado, feriadosDelMes } from "./feriados";

describe("feriados", () => {
  it("septiembre no tiene feriados nacionales; octubre sí", () => {
    expect(feriadosDelMes("2026-09")).toEqual([]);
    expect(feriadosDelMes("2026-10")).toEqual(["2026-10-12"]);
    expect(feriadosDelMes("2025-09")).toEqual([]);
  });
  it("año sin calendario: no se sabe", () => {
    expect(feriadosDelMes("2030-09")).toBeNull();
  });
  it("reconoce el concepto", () => {
    expect(esConceptoFeriado("Feriados")).toBe(true);
    expect(esConceptoFeriado("Liquidacion Sueldo")).toBe(false);
  });
});
