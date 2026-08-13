import { describe, it, expect } from "vitest";
import {
  parseMontoARS,
  pctSobreIngresos,
  diferenciaCajaMensual,
  heatmapFill,
  heatmapFillZeroAnchored,
  heatmapTextZeroAnchored,
  RESULT_COLORS,
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

describe("diferenciaCajaMensual", () => {
  it("null si falta el disponible del mes actual", () => {
    expect(diferenciaCajaMensual(null, 100, 50, 20)).toBeNull();
  });

  it("null si falta el disponible del mes anterior", () => {
    expect(diferenciaCajaMensual(100, undefined, 50, 20)).toBeNull();
  });

  it("resultadoOP y ganancia undefined se tratan como 0", () => {
    expect(diferenciaCajaMensual(150, 100, undefined, undefined)).toBe(50);
  });

  it("calcula ΔCaja menos (Resultado OP - Ganancia)", () => {
    // ΔCaja = 150-100 = 50; Resultado OP - Ganancia = 30-10 = 20; Diferencia = 50-20 = 30
    expect(diferenciaCajaMensual(150, 100, 30, 10)).toBe(30);
  });

  it("resultado negativo cuando el gasto societario supera la variación de caja", () => {
    expect(diferenciaCajaMensual(100, 150, 30, 10)).toBe(-70);
  });

  it("fixture real del PDF — feb 2026: disponible 9.297.875/5.670.649, resultado OP 7.876.831, ganancia 3.737.455", () => {
    expect(diferenciaCajaMensual(9_297_875, 5_670_649, 7_876_831, 3_737_455)).toBe(-512_150);
  });

  it("fixture real del PDF — ene 2026 con arrastre de diciembre 2025: disponible 5.670.649/1.181.305, resultado OP 5.443.199, ganancia 3.817.903", () => {
    expect(diferenciaCajaMensual(5_670_649, 1_181_305, 5_443_199, 3_817_903)).toBe(2_864_048);
  });
});

describe("heatmapFill", () => {
  it("banda baja (ratio < 1/3) da rojo con texto blanco", () => {
    expect(heatmapFill(0, 0, 100)).toEqual({ background: RESULT_COLORS.negative, foreground: "#ffffff" });
  });

  it("banda alta (ratio >= 2/3) da verde con texto blanco", () => {
    expect(heatmapFill(100, 0, 100)).toEqual({ background: RESULT_COLORS.positive, foreground: "#ffffff" });
  });

  it("banda media da ámbar con texto blanco", () => {
    expect(heatmapFill(50, 0, 100)).toEqual({ background: RESULT_COLORS.neutral, foreground: "#ffffff" });
  });

  it("ratio exactamente en 1/3 cae en la banda media, no en la baja", () => {
    expect(heatmapFill(100, 0, 300)).toEqual({ background: RESULT_COLORS.neutral, foreground: "#ffffff" });
  });

  it("ratio justo debajo de 1/3 cae en la banda baja", () => {
    expect(heatmapFill(99, 0, 300)).toEqual({ background: RESULT_COLORS.negative, foreground: "#ffffff" });
  });

  it("ratio exactamente en 2/3 cae en la banda alta, no en la media", () => {
    expect(heatmapFill(200, 0, 300)).toEqual({ background: RESULT_COLORS.positive, foreground: "#ffffff" });
  });

  it("ratio justo debajo de 2/3 cae en la banda media", () => {
    expect(heatmapFill(199, 0, 300)).toEqual({ background: RESULT_COLORS.neutral, foreground: "#ffffff" });
  });

  it("min === max (un solo mes visible) devuelve la banda media, no un extremo", () => {
    expect(heatmapFill(50, 50, 50)).toEqual({ background: RESULT_COLORS.neutral, foreground: "#ffffff" });
  });
});

describe("heatmapFillZeroAnchored", () => {
  it("el valor más negativo de la fila da la banda roja", () => {
    expect(heatmapFillZeroAnchored(-100, -100, 50)).toEqual({ background: RESULT_COLORS.negative, foreground: "#ffffff" });
  });

  it("el valor más positivo de la fila da la banda verde", () => {
    expect(heatmapFillZeroAnchored(50, -100, 50)).toEqual({ background: RESULT_COLORS.positive, foreground: "#ffffff" });
  });

  it("valor 0 siempre da la banda ámbar, sea cual sea el resto de la fila", () => {
    expect(heatmapFillZeroAnchored(0, -100, 50)).toEqual({ background: RESULT_COLORS.neutral, foreground: "#ffffff" });
  });

  it("fila toda positiva: el mínimo de la fila (0) no pinta rojo, a diferencia de heatmapFill", () => {
    expect(heatmapFillZeroAnchored(0, 0, 100)).toEqual({ background: RESULT_COLORS.neutral, foreground: "#ffffff" });
  });

  it("fila toda negativa: el máximo de la fila (0) no pinta verde, a diferencia de heatmapFill", () => {
    expect(heatmapFillZeroAnchored(0, -100, 0)).toEqual({ background: RESULT_COLORS.neutral, foreground: "#ffffff" });
  });

  it("min === max positivo (un solo mes visible) da la banda verde, no la ámbar de heatmapFill, porque el punto medio está anclado en 0 real", () => {
    expect(heatmapFillZeroAnchored(50, 50, 50)).toEqual({ background: RESULT_COLORS.positive, foreground: "#ffffff" });
  });

  it("min === max === 0 da la banda ámbar", () => {
    expect(heatmapFillZeroAnchored(0, 0, 0)).toEqual({ background: RESULT_COLORS.neutral, foreground: "#ffffff" });
  });
});

describe("heatmapTextZeroAnchored", () => {
  it("el valor más negativo de la fila da rojo", () => {
    expect(heatmapTextZeroAnchored(-100, -100, 50)).toBe(RESULT_COLORS.negative);
  });

  it("el valor más positivo de la fila da verde", () => {
    expect(heatmapTextZeroAnchored(50, -100, 50)).toBe(RESULT_COLORS.positive);
  });

  it("valor 0 siempre da ámbar", () => {
    expect(heatmapTextZeroAnchored(0, -100, 50)).toBe(RESULT_COLORS.neutral);
  });

  it("fila toda positiva: el mínimo de la fila (0) no pinta rojo", () => {
    expect(heatmapTextZeroAnchored(0, 0, 100)).toBe(RESULT_COLORS.neutral);
  });

  it("fila toda negativa: el máximo de la fila (0) no pinta verde", () => {
    expect(heatmapTextZeroAnchored(0, -100, 0)).toBe(RESULT_COLORS.neutral);
  });

  it("min === max positivo da verde, no el ámbar de heatmapText", () => {
    expect(heatmapTextZeroAnchored(50, 50, 50)).toBe(RESULT_COLORS.positive);
  });

  it("min === max === 0 da ámbar", () => {
    expect(heatmapTextZeroAnchored(0, 0, 0)).toBe(RESULT_COLORS.neutral);
  });
});
