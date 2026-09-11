import { describe, it, expect } from "vitest";
import { buildPivotDataByProveedor } from "./pivot-por-proveedor";
import { SIN_PROVEEDOR_NOMBRE } from "./constants";
import type { SqlRow } from "./types";

function row(overrides: Partial<SqlRow>): SqlRow {
  return {
    rubro_codigo: "R1", rubro_nombre: "Rubro 1",
    concepto_codigo: "C1", concepto_nombre: "Concepto 1",
    proveedor_id: 1, proveedor_nombre: "Proveedor A",
    mes: 1, total: 100, row_id: "row-1", distribucion_id: null,
    fecha: "2026-01-01", observac: null, has_manual_override: false,
    ...overrides,
  };
}

describe("buildPivotDataByProveedor", () => {
  it("agrupa por proveedor y luego por concepto, sin mezclar proveedores", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, proveedor_nombre: "Proveedor A", concepto_codigo: "C1", row_id: "a1", total: 100 }),
      row({ proveedor_id: 2, proveedor_nombre: "Proveedor B", concepto_codigo: "C1", row_id: "b1", total: 200 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});

    expect(data.rows).toHaveLength(2);
    const provA = data.rows.find((p) => p.proveedorId === 1)!;
    const provB = data.rows.find((p) => p.proveedorId === 2)!;
    expect(provA.rowTotal).toBe(100);
    expect(provB.rowTotal).toBe(200);
    expect(provA.children).toHaveLength(1);
    expect(provA.children[0].conceptoCodigo).toBe("C1");
    expect(provA.children[0].rowTotal).toBe(100);
  });

  it("rollup mensual correcto en el nivel proveedor y en los totales generales", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", mes: 1, total: 100 }),
      row({ proveedor_id: 1, concepto_codigo: "C2", concepto_nombre: "Concepto 2", row_id: "a2", mes: 1, total: 50 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const provA = data.rows[0];
    expect(provA.values[1]).toBe(150);
    expect(provA.rowTotal).toBe(150);
    expect(data.columnTotals[1]).toBe(150);
    expect(data.grandTotal).toBe(150);
  });

  it("proveedor null usa la clave __sin_proveedor y muestra el label sentinela sin importar el texto crudo del ERP", () => {
    // La SQL real cae a c.proveedor (texto crudo, no vinculado) en esta columna
    // cuando proveedor_id es null, antes de llegar al literal 'Sin Proveedor' —
    // este fixture reproduce ese caso realista en vez de uno que ya trae el label limpio.
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "CARNICERIA LOPEZ SRL", row_id: "x1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    expect(data.rows[0].proveedorId).toBeNull();
    expect(data.rows[0].id).toBe("__sin_proveedor");
    expect(data.rows[0].nombre).toBe(SIN_PROVEEDOR_NOMBRE);
  });

  it("adjunta la composición correspondiente a cada concepto+proveedor", () => {
    const rows: SqlRow[] = [row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1" })];
    const composicion = { "C1|1": { 1: { total: 100, destinos: [{ nombre: "Local A", pct: 100, importe: 100 }] } } };
    const data = buildPivotDataByProveedor(rows, composicion);
    expect(data.rows[0].children[0].composicion).toEqual(composicion["C1|1"]);
  });

  it("dos líneas de la misma compra distribuida no colisionan de id", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", distribucion_id: 10, total: 60 }),
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", distribucion_id: 11, total: 40 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const lineaIds = data.rows[0].children[0].children.map((l) => l.id);
    expect(new Set(lineaIds).size).toBe(2);
  });
});
