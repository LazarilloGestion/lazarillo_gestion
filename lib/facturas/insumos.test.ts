import { describe, it, expect } from "vitest";
import { unirInsumos } from "./insumos";

const m = (codigo: string, nombre: string, codCga: string | null, extra = {}) => ({ codigo, nombre, medida: "K", rubro: "Carnes", codCga, precio: 100, discontinuado: false, ...extra });

describe("unirInsumos", () => {
  it("el concepto sale del rubro aunque la compra no lo tenga", () => {
    const r = unirInsumos([m("505", "Carne Picada Cerdo", "4")], [{ codigo: "505", nombre: "Carne Picada Cerdo", medida: "K", codCga: null, unit: 9000, alic: 10.5 }]);
    expect(r).toEqual([{ codigo: "505", nombre: "Carne Picada Cerdo", medida: "K", codCga: "4", rubro: "Carnes", unit: 9000, alic: 10.5 }]);
  });
  it("rubro sin concepto: usa el de la última compra; sin compra, precio del maestro", () => {
    const r = unirInsumos([m("1", "A", null), m("2", "B", null)], [{ codigo: "1", nombre: "A", medida: "K", codCga: "7", unit: 5, alic: 21 }]);
    expect(r.map((x) => [x.codCga, x.unit])).toEqual([["7", 5], [null, 100]]);
  });
  it("saca discontinuados, suma los que solo están en el 25 y desambigua nombres", () => {
    const r = unirInsumos([m("1", "A", "1", { discontinuado: true }), m("2", "X", "1"), m("3", "X", "1")], [{ codigo: "9", nombre: "Z", medida: "U", codCga: "3", unit: 1, alic: 21 }, { codigo: "1", nombre: "A", medida: "K", codCga: "1", unit: 1, alic: 21 }]);
    expect(r.map((x) => x.nombre)).toEqual(["X (2)", "X (3)", "Z"]);
  });
});
