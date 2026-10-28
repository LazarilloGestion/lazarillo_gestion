import { describe, it, expect } from "vitest";
import { proyectarGastos } from "./proyeccion-gastos";

// Bar, octubre 2026 al 26/10 (millones): lo que planteó Diego — promedio ~85 M, daba 73 M.
const hist = [
  { ventas: 98.6, rubros: [{ rubro: "Mercaderias", total: 31.9 }, { rubro: "Gastos En Personal", total: 33.0 }, { rubro: "Otros Gastos", total: 3.6 }, { rubro: "Servicios", total: 7.6 }] },
  { ventas: 91.8, rubros: [{ rubro: "Mercaderias", total: 29.2 }, { rubro: "Gastos En Personal", total: 33.0 }, { rubro: "Otros Gastos", total: 4.1 }, { rubro: "Servicios", total: 6.9 }] },
  { ventas: 88.4, rubros: [{ rubro: "Mercaderias", total: 31.3 }, { rubro: "Gastos En Personal", total: 34.0 }, { rubro: "Otros Gastos", total: 5.2 }, { rubro: "Servicios", total: 5.9 }] },
];

describe("proyectarGastos", () => {
  it("mercadería por food cost × ventas proyectadas; el resto, su promedio", () => {
    const p = proyectarGastos({
      cargado: [{ rubro: "Mercaderias", total: 18.7 }, { rubro: "Gastos en Personal", total: 5.5 }, { rubro: "Otros Gastos", total: 3.1 }, { rubro: "Servicios", total: 4.7 }],
      sinCargar: [{ rubro: "Gastos En Personal", ultimo: 26.6 }, { rubro: "Mercaderias", ultimo: 1.3 }, { rubro: "Servicios", ultimo: 1.8 }],
      historia: hist, ventasProy: 93,
    });
    const r = (n: string) => p.rubros.find((x) => x.rubro.toLowerCase().startsWith(n))!;
    expect(r("mercader").total).toBeCloseTo((92.4 / 278.8) * 93, 1); // ~30,8
    expect(r("gastos en personal").total).toBeCloseTo(33.33, 1);    // promedio > 5,5 + 26,6
    expect(r("otros").total).toBeCloseTo(4.3, 1);
    expect(r("servicios").total).toBeCloseTo(6.8, 1);
    expect(p.total).toBeGreaterThan(74);
  });
  it("si ya se cargó más que el promedio, manda lo cargado", () => {
    const p = proyectarGastos({ cargado: [{ rubro: "Servicios", total: 12 }], sinCargar: [], historia: hist, ventasProy: 93 });
    expect(p.rubros.find((x) => x.rubro === "Servicios")!.total).toBe(12);
  });
  it("sin historia: cargado + sin cargar", () => {
    const p = proyectarGastos({ cargado: [{ rubro: "Servicios", total: 2 }], sinCargar: [{ rubro: "servicios", ultimo: 1 }], historia: [], ventasProy: 50 });
    expect(p.total).toBe(3);
  });
});
