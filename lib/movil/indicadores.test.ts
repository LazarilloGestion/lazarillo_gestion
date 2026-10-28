import { describe, it, expect } from "vitest";
import { difPp, indicadores, promedioMensual } from "./indicadores";

describe("indicadores del celu", () => {
  it("food cost, personal, mix y rentabilidad", () => {
    const i = indicadores(100, [{ rubro: "Mercaderias", total: 33 }, { rubro: "Gastos En Personal", total: 36 }, { rubro: "Alquiler", total: 13 }]);
    expect(i.foodCost).toBeCloseTo(0.33); expect(i.personal).toBeCloseTo(0.36); expect(i.mix).toBeCloseTo(0.69);
    expect(i.resultado).toBe(18); expect(i.rentabilidad).toBeCloseTo(0.18);
  });
  it("sin ventas no hay %", () => {
    expect(indicadores(0, [{ rubro: "Mercaderias", total: 5 }]).foodCost).toBeNull();
  });
  it("diferencia en puntos", () => {
    expect(difPp(0.331, 0.354)).toBeCloseTo(-2.3, 5);
    expect(difPp(null, 0.3)).toBeNull();
  });
  it("promedio mensual: totales / meses y % sobre el total", () => {
    const p = promedioMensual([
      { ventas: 100, rubros: [{ rubro: "Mercaderias", total: 30 }] },
      { ventas: 300, rubros: [{ rubro: "Mercaderias", total: 120 }] },
      { ventas: 0, rubros: [] },
    ])!;
    expect(p.meses).toBe(2); expect(p.ventas).toBe(200); expect(p.foodCost).toBeCloseTo(150 / 400);
  });
});
