import { describe, it, expect } from "vitest";
import {
  parseMontoARS,
  pctSobreIngresos,
  diferenciaCaja,
  computeDiferenciaCajaAcumulada,
  heatmapFill,
  heatmapText,
  heatmapFillZeroAnchored,
  heatmapTextZeroAnchored,
} from "./resultados-calc";

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

  it("resta egresos y ganancia, suma flujo de caja, a los ingresos", () => {
    expect(diferenciaCaja(1000, 400, 100, 50)).toBe(550);
  });

  it("mezcla de valores definidos e indefinidos trata los undefined como 0", () => {
    expect(diferenciaCaja(1000, undefined, 100, undefined)).toBe(900);
  });

  it("resultado negativo", () => {
    expect(diferenciaCaja(100, 500, 0, 0)).toBe(-400);
  });
});

describe("heatmapFill", () => {
  it("mínimo da el extremo rojo con texto blanco", () => {
    expect(heatmapFill(0, 0, 100)).toEqual({ background: "#d64545", foreground: "#ffffff" });
  });

  it("máximo da el extremo verde con texto blanco", () => {
    expect(heatmapFill(100, 0, 100)).toEqual({ background: "#1f9b59", foreground: "#ffffff" });
  });

  it("valor medio da el ámbar con texto oscuro (luminancia alta)", () => {
    expect(heatmapFill(50, 0, 100)).toEqual({ background: "#f2c94c", foreground: "#1f1f1d" });
  });

  it("min === max (un solo mes visible) devuelve el punto medio, no un extremo", () => {
    expect(heatmapFill(50, 50, 50)).toEqual({ background: "#f2c94c", foreground: "#1f1f1d" });
  });
});

describe("heatmapText", () => {
  it("mínimo da el rojo apagado", () => {
    expect(heatmapText(0, 0, 100)).toBe("#be423c");
  });

  it("máximo da el verde apagado", () => {
    expect(heatmapText(100, 0, 100)).toBe("#2e8554");
  });

  it("valor medio da el ámbar apagado", () => {
    expect(heatmapText(50, 0, 100)).toBe("#a8832c");
  });

  it("min === max devuelve el punto medio", () => {
    expect(heatmapText(7, 7, 7)).toBe("#a8832c");
  });
});

describe("heatmapFillZeroAnchored", () => {
  it("el valor más negativo de la fila da el extremo rojo", () => {
    expect(heatmapFillZeroAnchored(-100, -100, 50)).toEqual({ background: "#d64545", foreground: "#ffffff" });
  });

  it("el valor más positivo de la fila da el extremo verde", () => {
    expect(heatmapFillZeroAnchored(50, -100, 50)).toEqual({ background: "#1f9b59", foreground: "#ffffff" });
  });

  it("valor 0 siempre da el ámbar, sea cual sea el resto de la fila", () => {
    expect(heatmapFillZeroAnchored(0, -100, 50)).toEqual({ background: "#f2c94c", foreground: "#1f1f1d" });
  });

  it("fila toda positiva: el mínimo de la fila (0) no pinta rojo, a diferencia de heatmapFill", () => {
    expect(heatmapFillZeroAnchored(0, 0, 100)).toEqual({ background: "#f2c94c", foreground: "#1f1f1d" });
  });

  it("fila toda negativa: el máximo de la fila (0) no pinta verde, a diferencia de heatmapFill", () => {
    expect(heatmapFillZeroAnchored(0, -100, 0)).toEqual({ background: "#f2c94c", foreground: "#1f1f1d" });
  });

  it("min === max positivo (un solo mes visible) da el extremo verde, no el ámbar de heatmapFill, porque el punto medio está anclado en 0 real", () => {
    expect(heatmapFillZeroAnchored(50, 50, 50)).toEqual({ background: "#1f9b59", foreground: "#ffffff" });
  });

  it("min === max === 0 da el ámbar", () => {
    expect(heatmapFillZeroAnchored(0, 0, 0)).toEqual({ background: "#f2c94c", foreground: "#1f1f1d" });
  });
});

describe("heatmapTextZeroAnchored", () => {
  it("el valor más negativo de la fila da el rojo apagado", () => {
    expect(heatmapTextZeroAnchored(-100, -100, 50)).toBe("#be423c");
  });

  it("el valor más positivo de la fila da el verde apagado", () => {
    expect(heatmapTextZeroAnchored(50, -100, 50)).toBe("#2e8554");
  });

  it("valor 0 siempre da el ámbar apagado", () => {
    expect(heatmapTextZeroAnchored(0, -100, 50)).toBe("#a8832c");
  });

  it("fila toda positiva: el mínimo de la fila (0) no pinta rojo", () => {
    expect(heatmapTextZeroAnchored(0, 0, 100)).toBe("#a8832c");
  });

  it("fila toda negativa: el máximo de la fila (0) no pinta verde", () => {
    expect(heatmapTextZeroAnchored(0, -100, 0)).toBe("#a8832c");
  });

  it("min === max positivo da el extremo verde apagado, no el ámbar de heatmapText", () => {
    expect(heatmapTextZeroAnchored(50, 50, 50)).toBe("#2e8554");
  });

  it("min === max === 0 da el ámbar apagado", () => {
    expect(heatmapTextZeroAnchored(0, 0, 0)).toBe("#a8832c");
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
