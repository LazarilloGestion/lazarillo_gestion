import { describe, it, expect } from "vitest";
import { rangosLibres, cantidadLibres, textoRango, libreDesde } from "./codigos-libres";

describe("rangosLibres", () => {
  it("arma los huecos entre 1 y el máximo", () => {
    const r = rangosLibres([1, 2, 3, 6, 10], 12);
    expect(r).toEqual([{ desde: 4, hasta: 5 }, { desde: 7, hasta: 9 }, { desde: 11, hasta: 12 }]);
    expect(cantidadLibres(r)).toBe(7);
    expect(r.map(textoRango)).toEqual(["4–5", "7–9", "11–12"]);
  });
  it("ignora códigos fuera de rango o repetidos", () => {
    expect(rangosLibres([0, 1, 1, 1000, 2], 3)).toEqual([{ desde: 3, hasta: 3 }]);
    expect(rangosLibres([1, 2, 3], 3)).toEqual([]);
  });
  it("primer libre desde un código", () => {
    const r = rangosLibres([1, 2, 3, 6, 10], 12);
    expect(libreDesde(r, 1)).toBe(4);
    expect(libreDesde(r, 6)).toBe(7);
    expect(libreDesde(r, 8)).toBe(8);
    expect(libreDesde(r, 13)).toBeNull();
  });
});
