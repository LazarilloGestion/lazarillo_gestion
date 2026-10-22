import { describe, it, expect } from "vitest";
import { computePctCelda, computePctLabel, makeFmtCelda } from "./use-pct-mode";

describe("computePctCelda (toggle $ / % ing, punto 6 Etapa 3)", () => {
  it("peso del valor sobre los ingresos del mes, un decimal", () => {
    expect(computePctCelda(31953330, 74736646)).toBe("42.8%");
  });
  it("sin valor o sin ingresos del mes → —", () => {
    expect(computePctCelda(undefined, 74736646)).toBe("—");
    expect(computePctCelda(1000, undefined)).toBe("—");
    expect(computePctCelda(1000, 0)).toBe("—");
  });
  it("misma convención que el % ing de la columna Total", () => {
    expect(computePctCelda(284919214, 727271704)).toBe(computePctLabel(284919214, 727271704, false));
  });
});

describe("makeFmtCelda", () => {
  const ingresos = { 5: 74736646, 6: 68484819 };
  it("modo importe → pesos", () => {
    expect(makeFmtCelda("importe", ingresos, true)(31953330, 5)).toMatch(/^\$\s?31\.953\.330$/);
  });
  it("modo pct → % del mes; mientras cargan los ingresos muestra …", () => {
    expect(makeFmtCelda("pct", ingresos, true)(31953330, 5)).toBe("42.8%");
    expect(makeFmtCelda("pct", ingresos, true)(undefined, 5)).toBe("—");
    expect(makeFmtCelda("pct", {}, false)(31953330, 5)).toBe("…");
  });
});
