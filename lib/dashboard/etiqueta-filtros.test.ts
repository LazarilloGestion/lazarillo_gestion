import { describe, expect, it } from "vitest";
import { etiquetaMeses, leerLugar, valorLugar } from "./etiqueta-filtros";

describe("etiquetaMeses", () => {
  it("ninguno o todos = todo el año", () => {
    expect(etiquetaMeses([])).toBe("Todo el año");
    expect(etiquetaMeses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe("Todo el año");
  });
  it("uno, seguidos y sueltos", () => {
    expect(etiquetaMeses([9])).toBe("Sep");
    expect(etiquetaMeses(new Set([10, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe("Ene–Oct");
    expect(etiquetaMeses([1, 3, 6])).toBe("Ene, Mar, Jun");
    expect(etiquetaMeses([1, 3, 6, 8])).toBe("4 meses");
  });
});

describe("lugar", () => {
  it("ida y vuelta", () => {
    expect(valorLugar()).toBe("__all");
    expect(valorLugar(1)).toBe("l:1");
    expect(valorLugar(1, 2)).toBe("p:1:2");
    expect(leerLugar("p:1:2")).toEqual({ localId: 1, pdvId: 2 });
    expect(leerLugar("l:3")).toEqual({ localId: 3 });
    expect(leerLugar("__all")).toEqual({});
  });
});
