import { describe, expect, it } from "vitest";
import { aumentosVsCostos, detectarSemanas, type SemanaPrecios } from "./aumentos";

// Semanas reales del Bar 2026 (informe 12): ruido de fondo y los tres aumentos.
const s = (semana: string, n: number, suben: number, variacion: number): SemanaPrecios => ({ semana, n, suben, variacion });
const bar: SemanaPrecios[] = [
  s("2026-03-30", 79, 0.38, 0.021), s("2026-04-06", 84, 0.33, -0.021),
  s("2026-06-08", 83, 0.18, 0.005), s("2026-06-15", 75, 0.36, 0.030), s("2026-06-22", 66, 0.27, 0.026),
  s("2026-08-17", 105, 0.15, 0.003), s("2026-08-24", 79, 0.67, 0.057), s("2026-08-31", 85, 0.25, -0.003),
  s("2026-10-12", 86, 0.21, 0.005), s("2026-10-19", 76, 0.61, 0.035), s("2026-10-26", 16, 0.44, 0.019),
];

describe("detectarSemanas", () => {
  it("encuentra los tres aumentos confirmados por Diego y nada más", () => {
    expect(detectarSemanas(bar)).toEqual(["2026-06-15", "2026-08-24", "2026-10-19"]);
  });
  it("dos semanas seguidas = un aumento", () => {
    expect(detectarSemanas([s("2026-01-05", 50, 0.5, 0.04), s("2026-01-12", 50, 0.5, 0.03)])).toEqual(["2026-01-05"]);
  });
  it("pocas ventas no alcanzan", () => {
    expect(detectarSemanas([s("2026-01-05", 10, 0.9, 0.1)])).toEqual([]);
  });
});

describe("aumentosVsCostos", () => {
  const meses = ["2026-06", "2026-07", "2026-08", "2026-09"];
  const canasta = [0.015, 0.052, 0.005, 0.009];
  const filas = aumentosVsCostos(meses, canasta, [
    { fecha: "2026-06-15", pct: 0.039 }, { fecha: "2026-08-24", pct: 0.045 }, { fecha: "2026-10-19", pct: 0.075, provisorio: true },
  ]);
  it("el primero no tiene contra qué comparar", () => {
    expect(filas[0].costos).toBeNull();
    expect(filas[0].brecha).toBeNull();
  });
  it("24/08: costos de jul y ago contra el +4,5%", () => {
    expect(filas[1].costos).toBeCloseTo(1.052 * 1.005 - 1);
    expect(filas[1].brecha).toBeCloseTo(1.045 / (1.052 * 1.005) - 1);
  });
  it("19/10 cae después del mes de referencia: cuenta hasta sep y lo marca", () => {
    expect(filas[2].hastaMes).toBe("2026-09");
    expect(filas[2].costos).toBeCloseTo(0.009);
    expect(filas[2].provisorio).toBe(true);
  });
});
