import { describe, it, expect } from "vitest";
import { computePctLabel } from "./use-pct-mode";

describe("computePctLabel", () => {
  it("denominador 0: devuelve guion, sin dividir por cero", () => {
    expect(computePctLabel(500, 0, false)).toBe("—");
  });

  it("denominador positivo: devuelve porcentaje con 1 decimal", () => {
    expect(computePctLabel(50, 200, false)).toBe("25.0%");
  });

  it("isLoadingIngresos=true: devuelve el indicador de carga sin importar el resto", () => {
    expect(computePctLabel(50, 200, true)).toBe("…");
  });

  it("rowTotal 0 con denominador positivo: 0.0%, no guion", () => {
    expect(computePctLabel(0, 200, false)).toBe("0.0%");
  });
});
