import { describe, it, expect } from "vitest";
import { buildPivotDataByProveedor } from "./pivot-por-proveedor";
import type { SqlRow } from "./types";

function row(overrides: Partial<SqlRow>): SqlRow {
  return {
    rubro_codigo: "R1", rubro_nombre: "Rubro 1",
    concepto_codigo: "C1", concepto_nombre: "Concepto 1",
    proveedor_id: 1, proveedor_nombre: "Proveedor A", proveedor_texto_crudo: null,
    mes: 1, total: 100, row_id: "row-1", distribucion_id: null,
    fecha: "2026-01-01", observac: null, has_manual_override: false,
    local_id_origen: null, punto_de_venta_id_origen: null,
    ...overrides,
  };
}

describe("buildPivotDataByProveedor", () => {
  it("agrupa por rubro, luego proveedor, luego concepto, sin mezclar proveedores", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, proveedor_nombre: "Proveedor A", concepto_codigo: "C1", row_id: "a1", total: 100 }),
      row({ proveedor_id: 2, proveedor_nombre: "Proveedor B", concepto_codigo: "C1", row_id: "b1", total: 200 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});

    expect(data.rows).toHaveLength(1);
    const rubro = data.rows[0];
    expect(rubro.children).toHaveLength(2);
    const provA = rubro.children.find((p) => p.proveedorId === 1)!;
    const provB = rubro.children.find((p) => p.proveedorId === 2)!;
    expect(provA.rowTotal).toBe(100);
    expect(provB.rowTotal).toBe(200);
    expect(provA.children).toHaveLength(1);
    expect(provA.children[0].conceptoCodigo).toBe("C1");
    expect(provA.children[0].rowTotal).toBe(100);
  });

  it("un proveedor con compras en dos rubros aparece duplicado, uno por rubro, sin mezclar importes", () => {
    const rows: SqlRow[] = [
      row({ rubro_codigo: "R1", rubro_nombre: "Rubro 1", proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", total: 100 }),
      row({ rubro_codigo: "R2", rubro_nombre: "Rubro 2", proveedor_id: 1, concepto_codigo: "C2", concepto_nombre: "Concepto 2", row_id: "a2", total: 300 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});

    expect(data.rows).toHaveLength(2);
    const rubro1 = data.rows.find((r) => r.rubroCodigo === "R1")!;
    const rubro2 = data.rows.find((r) => r.rubroCodigo === "R2")!;
    expect(rubro1.children).toHaveLength(1);
    expect(rubro2.children).toHaveLength(1);
    expect(rubro1.children[0].proveedorId).toBe(1);
    expect(rubro2.children[0].proveedorId).toBe(1);
    expect(rubro1.children[0].rowTotal).toBe(100);
    expect(rubro2.children[0].rowTotal).toBe(300);
    expect(rubro1.children[0].id).not.toBe(rubro2.children[0].id);
    expect(data.grandTotal).toBe(400);
  });

  it("rollup mensual correcto en proveedor y rubro, y en los totales generales", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", mes: 1, total: 100 }),
      row({ proveedor_id: 1, concepto_codigo: "C2", concepto_nombre: "Concepto 2", row_id: "a2", mes: 1, total: 50 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const rubro = data.rows[0];
    const provA = rubro.children[0];
    expect(provA.values[1]).toBe(150);
    expect(provA.rowTotal).toBe(150);
    expect(rubro.values[1]).toBe(150);
    expect(rubro.rowTotal).toBe(150);
    expect(data.columnTotals[1]).toBe(150);
    expect(data.grandTotal).toBe(150);
  });

  it("proveedor_id null: usa el texto crudo del ERP como nombre del grupo, no un label sentinela", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "Diego", proveedor_texto_crudo: "Diego", row_id: "x1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const proveedor = data.rows[0].children[0];
    expect(proveedor.proveedorId).toBeNull();
    expect(proveedor.nombre).toBe("Diego");
    expect(proveedor.proveedorTexto).toBe("Diego");
  });

  it("dos textos crudos distintos sin proveedor real: dos nodos separados, no se mezclan", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "Diego", proveedor_texto_crudo: "Diego", row_id: "x1", total: 10 }),
      row({ proveedor_id: null, proveedor_nombre: "GASTOS VARIOS", proveedor_texto_crudo: "GASTOS VARIOS", row_id: "x2", total: 20 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const rubro = data.rows[0];
    expect(rubro.children).toHaveLength(2);
    const diego = rubro.children.find((p) => p.nombre === "Diego")!;
    const gastosVarios = rubro.children.find((p) => p.nombre === "GASTOS VARIOS")!;
    expect(diego.rowTotal).toBe(10);
    expect(gastosVarios.rowTotal).toBe(20);
    // El filtro de drill-down de cada nodo sale del texto crudo, no del COALESCE.
    expect(diego.proveedorTexto).toBe("Diego");
    expect(gastosVarios.proveedorTexto).toBe("GASTOS VARIOS");
  });

  it("mismo texto crudo con mayúsculas/tildes distintas: mismo nodo (agrupa normalizado)", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "Agustín", proveedor_texto_crudo: "Agustín", row_id: "x1", total: 10 }),
      row({ proveedor_id: null, proveedor_nombre: "AGUSTIN", proveedor_texto_crudo: "AGUSTIN", row_id: "x2", total: 15 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const rubro = data.rows[0];
    expect(rubro.children).toHaveLength(1);
    expect(rubro.children[0].rowTotal).toBe(25);
    // El label mostrado es el texto de la PRIMERA fila vista de ese grupo, no una forma normalizada.
    expect(rubro.children[0].nombre).toBe("Agustín");
  });

  it("sin proveedor ni texto crudo (el literal 'Sin Proveedor' de la SQL): cae en su propio grupo, separado de cualquier texto real", () => {
    const rows: SqlRow[] = [
      // Así llega la fila real: la columna cruda es null y el COALESCE de la SQL
      // cae al literal 'Sin Proveedor' para el label.
      row({ proveedor_id: null, proveedor_nombre: "Sin Proveedor", proveedor_texto_crudo: null, row_id: "x1", total: 5 }),
      row({ proveedor_id: null, proveedor_nombre: "Diego", proveedor_texto_crudo: "Diego", row_id: "x2", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const rubro = data.rows[0];
    expect(rubro.children).toHaveLength(2);
    const sinDatos = rubro.children.find((p) => p.nombre === "Sin Proveedor")!;
    const diego = rubro.children.find((p) => p.nombre === "Diego")!;
    expect(sinDatos.rowTotal).toBe(5);
    expect(diego.rowTotal).toBe(10);
    // Sin texto crudo, proveedorTexto debe ser null para que la UI mande
    // sinProveedor:true al drill-down (y no el literal del COALESCE, que no
    // coincide con ninguna fila real de c.proveedor).
    expect(sinDatos.proveedorTexto).toBeNull();
    expect(sinDatos.children[0].proveedorTexto).toBeNull();
    expect(diego.proveedorTexto).toBe("Diego");
    expect(diego.children[0].proveedorTexto).toBe("Diego");
  });

  it("proveedor real (proveedor_id no null): proveedorTexto queda null", () => {
    const rows: SqlRow[] = [row({ proveedor_id: 1, proveedor_nombre: "Proveedor A", row_id: "a1" })];
    const data = buildPivotDataByProveedor(rows, {});
    expect(data.rows[0].children[0].proveedorTexto).toBeNull();
  });

  it("adjunta la composición correspondiente a cada concepto+proveedor, sin importar el rubro", () => {
    const rows: SqlRow[] = [row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1" })];
    const composicion = { "C1|1": { 1: { total: 100, destinos: [{ nombre: "Local A", pct: 100, importe: 100 }] } } };
    const data = buildPivotDataByProveedor(rows, composicion);
    expect(data.rows[0].children[0].children[0].composicion).toEqual(composicion["C1|1"]);
  });

  it("dos líneas de la misma compra distribuida no colisionan de id", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", distribucion_id: 10, total: 60 }),
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", distribucion_id: 11, total: 40 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const lineaIds = data.rows[0].children[0].children[0].children.map((l) => l.id);
    expect(new Set(lineaIds).size).toBe(2);
  });
});
