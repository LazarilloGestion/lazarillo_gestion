import { describe, expect, it } from "vitest";
import { etiquetaSeleccion, sumarAnual, sumarProyeccion, sumarResumen, unirSinCarga } from "./multi";

describe("varios PDV juntos", () => {
  it("suma ventas y gastos por rubro", () => {
    const r = sumarResumen([
      { ventas: 100, gastos: 60, resultado: 40, rubros: [{ rubro: "Mercaderias", total: 30 }, { rubro: "Servicios", total: 30 }] },
      { ventas: 50, gastos: 20, resultado: 30, rubros: [{ rubro: "Mercaderias ", total: 20 }] },
    ]);
    expect(r).toMatchObject({ ventas: 150, gastos: 80, resultado: 70 });
    expect(r.rubros).toEqual([{ rubro: "Mercaderias", total: 50 }, { rubro: "Servicios", total: 30 }]);
  });
  it("año: suma mes a mes", () => {
    const a = sumarAnual([{ meses: [{ mes: 1, ventas: 10, gastos: 5, rubros: [{ rubro: "A", total: 5 }] }] }, { meses: [{ mes: 1, ventas: 5, gastos: 1, rubros: [{ rubro: "A", total: 1 }] }] }]);
    expect(a.meses[0]).toMatchObject({ mes: 1, ventas: 15, gastos: 6 });
    expect(a.meses).toHaveLength(12);
  });
  it("proyección: suma si todos proyectan el mismo mes; si uno no, nada", () => {
    const p = (f: number, pr: number, d: number) => ({ anio: 2026, mes: 10, facturado: f, proyeccion: pr, estimadoRestante: pr - f, diasRestantes: d }) as never;
    expect(sumarProyeccion([p(10, 20, 3), p(5, 8, 4)])).toMatchObject({ facturado: 15, proyeccion: 28, diasRestantes: 4 });
    expect(sumarProyeccion([p(10, 20, 3), null])).toBeNull();
  });
  it("sin carga: junta los gastos de cada mes", () => {
    const it0 = (clave: string) => ({ clave }) as never;
    const r = unirSinCarga([{ meses: [{ mes: "2026-10", items: [it0("a")] }] }, { meses: [{ mes: "2026-10", items: [it0("b")] }, { mes: "2026-09", items: [it0("c")] }] }]);
    expect(r.meses.map((m) => [m.mes, m.items.length])).toEqual([["2026-10", 2], ["2026-09", 1]]);
  });
  it("etiqueta del selector", () => {
    const L = [{ id: 1, nombre: "Ramos Mejía", puntosDeVenta: [{ id: 1, nombre: "Bar" }, { id: 2, nombre: "Canchas" }] }, { id: 2, nombre: "San Justo", puntosDeVenta: [{ id: 3, nombre: "Canchas" }] }];
    expect(etiquetaSeleccion(L, [1])).toBe("Ramos Mejía · Bar");
    expect(etiquetaSeleccion(L, [1, 2])).toBe("Todo Ramos Mejía");
    expect(etiquetaSeleccion(L, [1, 3])).toBe("2 PDV");
    expect(etiquetaSeleccion(L, [1, 2, 3])).toBe("Todos los PDV");
  });
});
