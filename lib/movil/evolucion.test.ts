import { describe, expect, it } from "vitest";
import { serieIndicador } from "./evolucion";

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
});
