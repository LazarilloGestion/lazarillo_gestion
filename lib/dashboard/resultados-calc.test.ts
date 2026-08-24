import { describe, it, expect } from "vitest";
import {
  parseMontoARS,
  pctSobreIngresos,
  computeDiferenciaCajaAcumulada,
  type MesDatos,
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

describe("computeDiferenciaCajaAcumulada", () => {
  // Serie de ejemplo: primer arqueo cargado en septiembre (mes 9). CA-01 a CA-03 del PDF.
  const serieBase: MesDatos[] = [
    { anio: 2026, mes: 7, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },  // jul
    { anio: 2026, mes: 8, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },  // ago
    { anio: 2026, mes: 9, ingresos: 100, egresos: 40, ganancia: 20, disponible: 500 },   // sep — primer arqueo
    { anio: 2026, mes: 10, ingresos: 120, egresos: 50, ganancia: 30, disponible: null }, // oct — sin arqueo propio
    { anio: 2026, mes: 11, ingresos: 110, egresos: 45, ganancia: 25, disponible: 600 },  // nov
  ];
  const primerArqueoSep = { anio: 2026, mes: 9 };

  it("CA-01 — sin ningún arqueo, primerArqueo null, todo el resultado es null", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, null);
    expect(resultado).toEqual([null, null, null, null, null]);
  });

  it("CA-02 — julio, agosto y septiembre (mes del primer arqueo inclusive) dan null", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    expect(resultado[0]).toBeNull(); // jul
    expect(resultado[1]).toBeNull(); // ago
    expect(resultado[2]).toBeNull(); // sep, mes del primer arqueo
  });

  it("CA-02 — octubre (mes siguiente al primer arqueo) da el primer valor calculado", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    // saldoInicial = disponible[sep] = 500
    // oct: (120-50) - 30 + (disponible ?? 0) = 70 - 30 + 0 = 40; acumulado = 500 + 40 = 540
    expect(resultado[3]).toBe(540);
  });

  it("CA-03 — octubre sin disponible propio no corta la cadena: noviembre sigue acumulando sobre octubre", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    // nov: (110-45) - 25 + 600 = 65 - 25 + 600 = 640; acumulado = 540 (oct) + 640 = 1180
    expect(resultado[4]).toBe(1180);
  });

  it("CA-04 — los meses sin cálculo válido son null, nunca 0", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    expect(resultado[0]).not.toBe(0);
    expect(resultado[0]).toBeNull();
  });

  it("caso cross-año — primer arqueo en el año anterior al último año de la serie, el acumulado sigue de corrido", () => {
    const serieCrossAnio: MesDatos[] = [
      { anio: 2025, mes: 11, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },
      { anio: 2025, mes: 12, ingresos: 100, egresos: 40, ganancia: 20, disponible: 1000 }, // primer arqueo
      { anio: 2026, mes: 1, ingresos: 120, egresos: 50, ganancia: 30, disponible: null },
      { anio: 2026, mes: 2, ingresos: 110, egresos: 45, ganancia: 25, disponible: 900 },
    ];
    const primerArqueoDic2025 = { anio: 2025, mes: 12 };
    const resultado = computeDiferenciaCajaAcumulada(serieCrossAnio, primerArqueoDic2025);
    expect(resultado[0]).toBeNull(); // nov 2025
    expect(resultado[1]).toBeNull(); // dic 2025, mes del primer arqueo
    // ene 2026: saldoInicial 1000 + [(120-50)-30+0] = 1000 + 40 = 1040
    expect(resultado[2]).toBe(1040);
    // feb 2026: 1040 + [(110-45)-25+900] = 1040 + 940 = 1980
    expect(resultado[3]).toBe(1980);
  });

  it("primerArqueo posterior al último mes de la serie (rango mal armado por el caller) da todo null", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, { anio: 2027, mes: 1 });
    expect(resultado).toEqual([null, null, null, null, null]);
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
