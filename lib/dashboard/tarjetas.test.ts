import { describe, expect, it } from "vitest";
import { mesCerrado, tarjetasDelMes } from "./tarjetas";

const m = (mes: number, ventas: number, merc: number, pers: number, otros = 0) => ({ mes, ventas, rubros: [{ rubro: "Mercaderias", total: merc }, { rubro: "Gastos En Personal", total: pers }, { rubro: "Servicios", total: otros }] });
const meses = [m(8, 91.8, 28.9, 33.15, 23), m(9, 88.4, 28.88, 33.84, 17.33), m(10, 50, 20, 10)];

describe("tarjetas del Panel", () => {
  it("último mes cerrado: el anterior al de hoy; año pasado → diciembre (o el último con ventas)", () => {
    expect(mesCerrado(meses, 2026, { anio: 2026, mes: 10 })).toBe(9);
    expect(mesCerrado(meses, 2025, { anio: 2026, mes: 10 })).toBe(10); // dic/nov sin ventas → octubre
    expect(mesCerrado(meses, 2026, { anio: 2026, mes: 1 })).toBeNull();
  });
  it("septiembre del Bar: mix, puntos vs agosto y equilibrio", () => {
    const t = tarjetasDelMes(meses, 9, 35.47)!;
    expect(t.mix!).toBeCloseTo((28.88 + 33.84) / 88.4, 6);
    expect(t.difMix!).toBeCloseTo(((28.88 + 33.84) / 88.4 - (28.9 + 33.15) / 91.8) * 100, 6);
    expect(t.ventasVsAnterior!).toBeCloseTo(88.4 / 91.8 - 1, 6);
    expect(t.equilibrio!.diferencia * t.equilibrio!.queda).toBeCloseTo(t.resultado, 6);
  });
  it("sin variables (Financiera o sin datos) no hay equilibrio", () => {
    expect(tarjetasDelMes(meses, 9, null)!.equilibrio).toBeNull();
  });
});
