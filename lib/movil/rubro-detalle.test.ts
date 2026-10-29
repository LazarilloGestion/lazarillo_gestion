import { describe, expect, it } from "vitest";
import { cargadasDe, esPersonal, lineasRubro } from "./rubro-detalle";

describe("detalle de rubro en el celu", () => {
  const rows = [
    { nombre: "Gastos En Personal ", rowTotal: 300, children: [{ nombre: "Pérez Juan", rowTotal: 100 }, { nombre: "Gómez Ana", rowTotal: 200 }] },
    { nombre: "Mercaderias", rowTotal: 50, children: [{ nombre: "Harina", rowTotal: 20 }, { nombre: "Harina ", rowTotal: 10 }, { nombre: "Queso", rowTotal: 0.1 }] },
  ];
  it("toma los hijos del rubro (sin importar espacios/mayúsculas), suma repetidos y saca los vacíos", () => {
    expect(cargadasDe(rows, "gastos en personal").map((l) => l.nombre)).toEqual(["Pérez Juan", "Gómez Ana"]);
    expect(cargadasDe(rows, "Mercaderias")).toEqual([{ nombre: "Harina", total: 30, tipo: "cargado" }]);
    expect(cargadasDe(undefined, "X")).toEqual([]);
  });
  it("suma sin cargar y el estimado, todo de mayor a menor", () => {
    const l = lineasRubro({ rubro: "Gastos En Personal", cargadas: cargadasDe(rows, "Gastos En Personal"),
      sinCargar: [{ rubro: "Gastos En Personal", nombre: "Sueldos período", ultimo: 150 }, { rubro: "Servicios", nombre: "Edenor", ultimo: 999 }], estimado: 120 });
    expect(l.map((x) => [x.nombre, x.tipo])).toEqual([["Gómez Ana", "cargado"], ["Sueldos período", "sinCargar"], ["Resto estimado", "estimado"], ["Pérez Juan", "cargado"]]);
  });
  it("Personal se reconoce por el nombre del rubro", () => {
    expect(esPersonal("Gastos En Personal")).toBe(true);
    expect(esPersonal("Mercaderias")).toBe(false);
  });
});
