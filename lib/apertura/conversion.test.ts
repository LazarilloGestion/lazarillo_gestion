import { describe, it, expect } from "vitest";
import { montoDesdePct, pctDesdeMonto } from "./conversion";

describe("montoDesdePct", () => {
  it("60% de 1.000.000 = 600.000", () => {
    expect(montoDesdePct(60, 1000000)).toBe(600000);
  });

  it("33.33% de 100 redondea a 2 decimales (33.33)", () => {
    expect(montoDesdePct(33.33, 100)).toBe(33.33);
  });

  it("0% de cualquier total = 0", () => {
    expect(montoDesdePct(0, 500000)).toBe(0);
  });

  it("100% devuelve el total exacto", () => {
    expect(montoDesdePct(100, 123456.78)).toBe(123456.78);
  });
});

describe("pctDesdeMonto", () => {
  it("600.000 de un total de 1.000.000 = 60%", () => {
    expect(pctDesdeMonto(600000, 1000000)).toBe(60);
  });

  it("total 0 devuelve 0% en vez de dividir por cero", () => {
    expect(pctDesdeMonto(500, 0)).toBe(0);
  });

  it("total negativo (no debería ocurrir en la práctica, pero no debe romper) devuelve 0%", () => {
    expect(pctDesdeMonto(500, -100)).toBe(0);
  });

  it("redondea a 2 decimales", () => {
    expect(pctDesdeMonto(1, 3)).toBe(33.33);
  });

  it("es la inversa de montoDesdePct para valores exactos", () => {
    const monto = montoDesdePct(45, 200000);
    expect(pctDesdeMonto(monto, 200000)).toBe(45);
  });
});
