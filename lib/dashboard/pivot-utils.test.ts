import { describe, it, expect } from "vitest";
import { sortPivotRowsPorProveedor, flattenRowsPorProveedor } from "./pivot-utils";
import type { PivotRubroRowPorProveedor, PivotProveedorSubRow, PivotConceptoSubRow, PivotLineaRow, PivotDataPorProveedor } from "./types";

function rubroRow(overrides: Partial<PivotRubroRowPorProveedor>): PivotRubroRowPorProveedor {
  return {
    level: 0, id: "R1", nombre: "Rubro 1", rubroCodigo: "R1",
    values: {}, rowTotal: 0, children: [],
    ...overrides,
  };
}

function proveedorRow(overrides: Partial<PivotProveedorSubRow>): PivotProveedorSubRow {
  return {
    level: 1, id: "R1|1", nombre: "Proveedor A", proveedorId: 1, proveedorTexto: null,
    values: {}, rowTotal: 0, children: [],
    ...overrides,
  };
}

describe("sortPivotRowsPorProveedor", () => {
  it("ordena rubros por total descendente", () => {
    const rows = [rubroRow({ id: "r1", rowTotal: 100 }), rubroRow({ id: "r2", rowTotal: 300 })];
    const sorted = sortPivotRowsPorProveedor(rows, "total", "desc");
    expect(sorted.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("no muta el array original", () => {
    const rows = [rubroRow({ id: "r1", rowTotal: 100 }), rubroRow({ id: "r2", rowTotal: 300 })];
    sortPivotRowsPorProveedor(rows, "total", "desc");
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

describe("flattenRowsPorProveedor", () => {
  it("solo incluye el nivel rubro cuando no hay nada expandido", () => {
    const data: PivotDataPorProveedor = { rows: [rubroRow({ id: "r1" })], columnTotals: {}, grandTotal: 0 };
    const flat = flattenRowsPorProveedor(data, new Set());
    expect(flat).toEqual([{ type: "rubroTop", data: data.rows[0] }]);
  });

  it("expande rubro, proveedor y concepto en cascada", () => {
    const linea: PivotLineaRow = {
      level: 3, id: "l1", rowId: "row-1", distribucionId: null, conceptoCodigo: "C1",
      fecha: null, observac: null, importe: 10, hasManualOverride: false,
      localIdOrigen: null, puntoDeVentaIdOrigen: null, values: {}, rowTotal: 10,
    };
    const concepto: PivotConceptoSubRow = {
      level: 2, id: "r1|p1|C1", nombre: "Concepto 1", conceptoCodigo: "C1", rubroCodigo: "r1", proveedorId: 1, proveedorTexto: null,
      values: {}, rowTotal: 10, children: [linea],
    };
    const proveedor = proveedorRow({ id: "r1|p1", children: [concepto] });
    const rubro = rubroRow({ id: "r1", children: [proveedor] });
    const data: PivotDataPorProveedor = { rows: [rubro], columnTotals: {}, grandTotal: 10 };

    const flat = flattenRowsPorProveedor(data, new Set(["r1", "r1|p1", "r1|p1|C1"]));
    expect(flat.map((f) => f.type)).toEqual(["rubroTop", "proveedorSub", "conceptoSub", "linea"]);
  });

  it("no expande proveedor si el rubro padre no está expandido", () => {
    const proveedor = proveedorRow({ id: "r1|p1" });
    const rubro = rubroRow({ id: "r1", children: [proveedor] });
    const data: PivotDataPorProveedor = { rows: [rubro], columnTotals: {}, grandTotal: 10 };

    const flat = flattenRowsPorProveedor(data, new Set(["r1|p1"]));
    expect(flat).toEqual([{ type: "rubroTop", data: rubro }]);
  });

  it("no expande concepto si el proveedor padre no está expandido", () => {
    const concepto: PivotConceptoSubRow = {
      level: 2, id: "r1|p1|C1", nombre: "Concepto 1", conceptoCodigo: "C1", rubroCodigo: "r1", proveedorId: 1, proveedorTexto: null,
      values: {}, rowTotal: 10, children: [],
    };
    const proveedor = proveedorRow({ id: "r1|p1", children: [concepto] });
    const rubro = rubroRow({ id: "r1", children: [proveedor] });
    const data: PivotDataPorProveedor = { rows: [rubro], columnTotals: {}, grandTotal: 10 };

    const flat = flattenRowsPorProveedor(data, new Set(["r1", "r1|p1|C1"]));
    expect(flat.map((f) => f.type)).toEqual(["rubroTop", "proveedorSub"]);
  });
});
