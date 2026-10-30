import { describe, expect, it } from "vitest";
import { alcanceAumento, aumentosVsCostos, detectarSemanas, grupoDeRubro, type VentanaGrupo } from "./aumentos";

// Ventanas reales del Bar (informe 12, sep-25 a oct-26) que pasaron el umbral o casi.
const v = (semana: string, grupo: VentanaGrupo["grupo"], n: number, suben: number, variacion: number): VentanaGrupo => ({ semana, grupo, n, suben, variacion });
const ventanas: VentanaGrupo[] = [
  v("2025-09-22", "bebidas", 71, 0.63, 0.046), v("2025-09-29", "comidas", 91, 0.57, 0.037), v("2025-10-06", "comidas", 87, 0.53, 0.037),
  v("2025-11-24", "promos", 32, 0.5, 0.031), v("2025-12-01", "bebidas", 73, 0.53, 0.045), v("2025-12-08", "promos", 30, 0.5, 0.05),
  v("2026-03-30", "bebidas", 65, 0.57, 0.055), v("2026-03-30", "comidas", 92, 0.33, 0.009),
  v("2026-06-08", "bebidas", 51, 0.51, 0.065), v("2026-06-15", "bebidas", 58, 0.57, 0.051),
  v("2026-08-17", "comidas", 98, 0.58, 0.043), v("2026-08-24", "comidas", 96, 0.68, 0.051), v("2026-08-31", "comidas", 93, 0.6, 0.061),
  v("2026-10-12", "comidas", 66, 0.71, 0.062), v("2026-10-19", "comidas", 16, 0.69, 0.078),
  v("2026-05-25", "comidas", 29, 0.41, 0.017), v("2025-12-01", "promos", 12, 0.9, 0.2),
];
const semanal = new Map([["2025-09-22", 0.2], ["2025-09-29", 0.4], ["2025-10-06", 0.25], ["2025-11-24", 0.1], ["2025-12-01", 0.32], ["2025-12-08", 0.2],
  ["2026-06-08", 0.18], ["2026-06-15", 0.36], ["2026-08-17", 0.15], ["2026-08-24", 0.67], ["2026-08-31", 0.25], ["2026-10-12", 0.21], ["2026-10-19", 0.61]]);

describe("detectarSemanas", () => {
  it("un aumento por racha de semanas marcadas, en la semana del salto", () => {
    expect(detectarSemanas(ventanas, semanal)).toEqual(["2025-09-29", "2025-12-01", "2026-03-30", "2026-06-15", "2026-08-24", "2026-10-19"]);
  });
  it("pocas ventas o poca suba no marcan", () => {
    expect(detectarSemanas([v("2026-01-05", "promos", 10, 0.9, 0.2), v("2026-01-05", "comidas", 80, 0.45, 0.05)], new Map())).toEqual([]);
  });
});

describe("grupo y alcance", () => {
  it("clasifica por rubro", () => {
    expect(grupoDeRubro("CERVEZAS")).toBe("bebidas");
    expect(grupoDeRubro("PROMOCIONES NO-REC")).toBe("promos");
    expect(grupoDeRubro("HAMBURGUESAS SIMPLES")).toBe("comidas");
    expect(grupoDeRubro(null)).toBe("comidas");
  });
  it("general no dice nada; parcial dice qué subió", () => {
    expect(alcanceAumento({ comidas: 0.051, bebidas: 0.033, promos: 0.046 })).toBeNull();
    expect(alcanceAumento({ comidas: 0.009, bebidas: 0.055, promos: -0.01 })).toBe("solo bebidas");
    expect(alcanceAumento({ comidas: 0.01, bebidas: 0.045, promos: 0.06 })).toBe("solo bebidas y promos");
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
