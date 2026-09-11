import { describe, it, expect } from "vitest";
import { sortPivotRowsPorProveedor, flattenRowsPorProveedor } from "./pivot-utils";
import type { PivotProveedorTopRow, PivotConceptoSubRow, PivotLineaRow, PivotDataPorProveedor } from "./types";

function proveedorRow(overrides: Partial<PivotProveedorTopRow>): PivotProveedorTopRow {
  return {
    level: 0, id: "p1", nombre: "Proveedor A", proveedorId: 1,
    values: {}, rowTotal: 0, children: [],
    ...overrides,
  };
}

describe("sortPivotRowsPorProveedor", () => {
  it("ordena proveedores por total descendente", () => {
    const rows = [proveedorRow({ id: "p1", rowTotal: 100 }), proveedorRow({ id: "p2", rowTotal: 300 })];
    const sorted = sortPivotRowsPorProveedor(rows, "total", "desc");
    expect(sorted.map((r) => r.id)).toEqual(["p2", "p1"]);
  });

  it("no muta el array original", () => {
    const rows = [proveedorRow({ id: "p1", rowTotal: 100 }), proveedorRow({ id: "p2", rowTotal: 300 })];
    sortPivotRowsPorProveedor(rows, "total", "desc");
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
  });
});

describe("flattenRowsPorProveedor", () => {
  it("solo incluye el nivel proveedor cuando no hay nada expandido", () => {
    const data: PivotDataPorProveedor = { rows: [proveedorRow({ id: "p1" })], columnTotals: {}, grandTotal: 0 };
    const flat = flattenRowsPorProveedor(data, new Set());
    expect(flat).toEqual([{ type: "proveedorTop", data: data.rows[0] }]);
  });

  it("expande proveedor y concepto en cascada", () => {
    const linea: PivotLineaRow = {
      level: 2, id: "l1", rowId: "row-1", distribucionId: null, conceptoCodigo: "C1",
      fecha: null, observac: null, importe: 10, hasManualOverride: false, values: {}, rowTotal: 10,
    };
    const concepto: PivotConceptoSubRow = {
      level: 1, id: "p1|C1", nombre: "Concepto 1", conceptoCodigo: "C1", rubroCodigo: "R1",
      values: {}, rowTotal: 10, children: [linea],
    };
    const proveedor = proveedorRow({ id: "p1", children: [concepto] });
    const data: PivotDataPorProveedor = { rows: [proveedor], columnTotals: {}, grandTotal: 10 };

    const flat = flattenRowsPorProveedor(data, new Set(["p1", "p1|C1"]));
    expect(flat.map((f) => f.type)).toEqual(["proveedorTop", "conceptoSub", "linea"]);
  });

  it("no expande concepto si el proveedor padre no está expandido", () => {
    const concepto: PivotConceptoSubRow = {
      level: 1, id: "p1|C1", nombre: "Concepto 1", conceptoCodigo: "C1", rubroCodigo: "R1",
      values: {}, rowTotal: 10, children: [],
    };
    const proveedor = proveedorRow({ id: "p1", children: [concepto] });
    const data: PivotDataPorProveedor = { rows: [proveedor], columnTotals: {}, grandTotal: 10 };

    // "p1|C1" expandido pero "p1" no — no debería aparecer el nivel concepto.
    const flat = flattenRowsPorProveedor(data, new Set(["p1|C1"]));
    expect(flat).toEqual([{ type: "proveedorTop", data: proveedor }]);
  });
});
