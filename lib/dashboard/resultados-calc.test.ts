import { describe, it, expect } from "vitest";
import { parseMontoARS, pctSobreIngresos, diferenciaCaja, computeDiferenciaCajaAcumulada } from "./resultados-calc";

describe("parseMontoARS", () => {
  it("acepta coma como separador decimal", () => {
    expect(parseMontoARS("1234,56")).toBe(1234.56);
  });

  it("acepta punto como separador decimal", () => {
    expect(parseMontoARS("1234.56")).toBe(1234.56);
  });

  it("string vacío es 0", () => {
    expect(parseMontoARS("")).toBe(0);
  });

  it("texto no numérico devuelve null", () => {
    expect(parseMontoARS("abc")).toBeNull();
  });

  it("recorta espacios", () => {
    expect(parseMontoARS("  1234,5  ")).toBe(1234.5);
  });

  it("formato AR con separador de miles", () => {
    expect(parseMontoARS("1.234,56")).toBe(1234.56);
  });

  it("formato AR con separador de miles y decimales en cero", () => {
    expect(parseMontoARS("12.345,00")).toBe(12345);
  });

  it("punto sin coma se interpreta como decimal, no como miles (ambigüedad resuelta a favor del comportamiento previo)", () => {
    expect(parseMontoARS("1.234")).toBe(1.234);
  });
});

describe("pctSobreIngresos", () => {
  it("denominador 0 devuelve guion", () => {
    expect(pctSobreIngresos(100, 0)).toBe("—");
  });

  it("caso normal calcula el porcentaje con un decimal", () => {
    expect(pctSobreIngresos(50, 200)).toBe("25.0%");
  });

  it("numerador negativo conserva el signo", () => {
    expect(pctSobreIngresos(-50, 200)).toBe("-25.0%");
  });
});

describe("diferenciaCaja", () => {
  it("todos los inputs undefined da 0, no NaN", () => {
    expect(diferenciaCaja(undefined, undefined, undefined, undefined)).toBe(0);
  });

  it("resta egresos, ganancia y flujo de caja de los ingresos", () => {
    expect(diferenciaCaja(1000, 400, 100, 50)).toBe(450);
  });

  it("mezcla de valores definidos e indefinidos trata los undefined como 0", () => {
    expect(diferenciaCaja(1000, undefined, 100, undefined)).toBe(900);
  });

  it("resultado negativo", () => {
    expect(diferenciaCaja(100, 500, 0, 0)).toBe(-400);
  });
});

describe("computeDiferenciaCajaAcumulada", () => {
  it("acumula en orden ascendente con saldoInicial 0", () => {
    const result = computeDiferenciaCajaAcumulada([1, 2, 3], { 1: 100, 2: -50, 3: 20 }, 0);
    expect(result).toEqual({ 1: 100, 2: 50, 3: 70 });
  });

  it("arrastra saldoInicial distinto de cero (caso enero con arrastre de diciembre)", () => {
    const result = computeDiferenciaCajaAcumulada([1, 2], { 1: 100, 2: 100 }, 500);
    expect(result).toEqual({ 1: 600, 2: 700 });
  });

  it("arrastra el signo negativo correctamente mes a mes", () => {
    const result = computeDiferenciaCajaAcumulada([1, 2, 3], { 1: -100, 2: -100, 3: 50 }, 0);
    expect(result).toEqual({ 1: -100, 2: -200, 3: -150 });
  });

  it("meses sin dato en diferenciaPorMes se tratan como 0 (no rompen el acumulado)", () => {
    const result = computeDiferenciaCajaAcumulada([1, 2, 3], { 1: 100, 3: 50 }, 0);
    expect(result).toEqual({ 1: 100, 2: 100, 3: 150 });
  });
});
