import { describe, expect, it } from "vitest";
import { serieIndicador, sentido } from "./evolucion";

const m = (anio: number, mes: number, ventas: number, merc: number) => ({ anio, mes, ventas, rubros: [{ rubro: "Mercaderias", total: merc }, { rubro: "Gastos En Personal", total: ventas * 0.3 }] });

describe("evolución de un indicador", () => {
  const meses = [m(2025, 11, 100, 30), m(2025, 12, 100, 32), m(2026, 1, 100, 31), m(2026, 2, 0, 0)];
  it("los últimos N hasta el mes elegido, cruzando el año, con pp vs el anterior", () => {
    const s = serieIndicador({ meses, clave: "foodCost", hasta: { anio: 2026, mes: 1 }, n: 2 });
    expect(s.map((x) => [x.anio, x.mes])).toEqual([[2025, 12], [2026, 1]]);
    expect(s[0].valor).toBeCloseTo(0.32);
    expect(s[0].dif).toBeCloseTo(2);
    expect(s[1].dif).toBeCloseTo(-1);
  });
  it("mes sin ventas = sin dato; el mes que se mira puede venir proyectado", () => {
    const s = serieIndicador({ meses, clave: "mix", hasta: { anio: 2026, mes: 2 }, n: 2 });
    expect(s[1].valor).toBeNull();
    const p = serieIndicador({ meses, clave: "foodCost", hasta: { anio: 2026, mes: 2 }, n: 2, actual: { valor: 0.35, proyectado: true } });
    expect(p[1]).toMatchObject({ valor: 0.35, proyectado: true });
    expect(p[1].dif).toBeCloseTo(4);
  });
  it("plata (ventas, gastos, resultado): diferencia en % contra el mes anterior", () => {
    const s = serieIndicador({ meses, clave: "ventas", hasta: { anio: 2026, mes: 1 }, n: 2 });
    expect(s.map((x) => x.valor)).toEqual([100, 100]);
    expect(s[1].dif).toBeCloseTo(0);
    const v = serieIndicador({ meses: [m(2025, 12, 100, 30), m(2026, 1, 125, 30)], clave: "ventas", hasta: { anio: 2026, mes: 1 }, n: 1 });
    expect(v[0].dif).toBeCloseTo(25);
    const r = serieIndicador({ meses: [m(2025, 12, 100, 80), m(2026, 1, 100, 60)], clave: "resultado", hasta: { anio: 2026, mes: 1 }, n: 1 });
    // resultado -10 → 10: sube 200% sobre el valor absoluto del anterior
    expect(r[0].valor).toBeCloseTo(10);
    expect(r[0].dif).toBeCloseTo(200);
  });
  it("rentabilidad en puntos; verde/rojo según hacia dónde conviene", () => {
    const s = serieIndicador({ meses: [m(2025, 12, 100, 30), m(2026, 1, 100, 20)], clave: "rentabilidad", hasta: { anio: 2026, mes: 1 }, n: 1 });
    expect(s[0].dif).toBeCloseTo(10);
    expect(sentido("rentabilidad", 10)).toBe("bueno");
    expect(sentido("gastos", 10)).toBe("malo");
    expect(sentido("foodCost", -2)).toBe("bueno");
    expect(sentido("ventas", 0.01)).toBeNull();
  });
});
