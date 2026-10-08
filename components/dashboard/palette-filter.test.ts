import { describe, it, expect } from "vitest";
import { filtroSinAcentos } from "./palette-filter";

describe("filtroSinAcentos", () => {
  it("encuentra 'eléctrico' tipeando sin tilde", () => {
    expect(filtroSinAcentos("observacion Trabajo eléctrico", "electrico")).toBeGreaterThan(0);
  });

  it("encuentra 'electrico' tipeando con tilde", () => {
    expect(filtroSinAcentos("observacion Trabajo electrico", "eléctrico")).toBeGreaterThan(0);
  });

  it("descarta lo que no matchea", () => {
    expect(filtroSinAcentos("observacion Canaletas patio", "pintura")).toBe(0);
  });
});
