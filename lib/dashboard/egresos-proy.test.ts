import { describe, it, expect } from "vitest";
import { egresosProyectados, historiaDe } from "./egresos-proy";

const mes = (m: number, ventas: number, merc: number, pers: number) => ({ mes: m, ventas, rubros: [{ rubro: "Mercaderias", total: merc }, { rubro: "Gastos En Personal", total: pers }] });
const anual = [mes(6, 100, 30, 28), mes(7, 100, 30, 28), mes(8, 100, 32, 28), mes(9, 100, 34, 30), { mes: 10, ventas: 50, rubros: [{ rubro: "Mercaderias", total: 10 }, { rubro: "Gastos En Personal", total: 5 }] }];

describe("egresosProyectados", () => {
  it("historia = 3 meses anteriores con ventas", () => {
    expect(historiaDe(anual, 10).map((m) => m.mes)).toEqual([7, 8, 9]);
  });
  it("mes en curso: cargado del pivot + sin cargar + variable (food cost × ventas proy.)", () => {
    const r = egresosProyectados({ anual, mesProy: 10, ventasProy: 120, cargadoPivot: 15, sinCargar: [{ rubro: "Gastos En Personal", ultimo: 20 }] })!;
    // Mercaderías: 96/300 × 120 = 38,4; Personal: max(5+20, 86/3=28,67) = 28,67
    expect(r.foodCost).toBeCloseTo(0.32);
    expect(r.sinCargar).toBe(20);
    expect(r.total).toBeCloseTo(15 + 20 + (38.4 - 10) + (86 / 3 - 25), 5);
    expect(r.rubros[0].rubro).toBe("Mercaderias");
  });
  it("sin historia no proyecta", () => {
    expect(egresosProyectados({ anual: [anual[4]], mesProy: 10, ventasProy: 120, cargadoPivot: 15, sinCargar: [] })).toBeNull();
  });
});
