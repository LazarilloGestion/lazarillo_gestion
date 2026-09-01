import { describe, it, expect } from "vitest";
import { buildRangoAniosUrl } from "./params";

describe("buildRangoAniosUrl", () => {
  it("sin filtros: ruta sin query string", () => {
    expect(buildRangoAniosUrl()).toBe("/api/dashboard/rango-anios");
  });

  it("con localId: agrega localId", () => {
    expect(buildRangoAniosUrl(3)).toBe("/api/dashboard/rango-anios?localId=3");
  });

  it("con localId y pdvId: agrega ambos como puntoDeVentaId", () => {
    expect(buildRangoAniosUrl(3, 7)).toBe("/api/dashboard/rango-anios?localId=3&puntoDeVentaId=7");
  });

  it("pdvId sin localId: agrega solo puntoDeVentaId", () => {
    expect(buildRangoAniosUrl(undefined, 7)).toBe("/api/dashboard/rango-anios?puntoDeVentaId=7");
  });
});
