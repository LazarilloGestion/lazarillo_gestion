import { describe, it, expect } from "vitest";
import { planFixProveedorCruzado, type CompraParaFix } from "./fix-proveedorid-cruzado";

function fila(overrides: Partial<CompraParaFix> = {}): CompraParaFix {
  return {
    rowId: "row-1",
    proveedor: "Juan Perez",
    proveedorNombre: "Juan Perez",
    proveedorRazon: null,
    ...overrides,
  };
}

describe("planFixProveedorCruzado", () => {
  it("texto coincide con el nombre actual: no se nulifica", () => {
    const plan = planFixProveedorCruzado([fila()]);
    expect(plan.rowIdANulificar).toHaveLength(0);
  });

  it("texto coincide solo con razon: no se nulifica", () => {
    const plan = planFixProveedorCruzado([
      fila({ proveedorNombre: "Distinto", proveedorRazon: "Juan Perez" }),
    ]);
    expect(plan.rowIdANulificar).toHaveLength(0);
  });

  it("caso real de regresión (Diego/Creacion Tm Sr): se nulifica", () => {
    const plan = planFixProveedorCruzado([
      fila({ rowId: "row-diego", proveedor: "Diego", proveedorNombre: "Creacion Tm Sr", proveedorRazon: null }),
    ]);
    expect(plan.rowIdANulificar).toEqual(["row-diego"]);
  });

  it("texto null: no se nulifica (sin evidencia en contra)", () => {
    const plan = planFixProveedorCruzado([fila({ proveedor: null, proveedorNombre: "Cualquiera" })]);
    expect(plan.rowIdANulificar).toHaveLength(0);
  });

  it("mezcla de filas: solo las que no matchean van a rowIdANulificar", () => {
    const plan = planFixProveedorCruzado([
      fila({ rowId: "ok-1" }),
      fila({ rowId: "cruzada-1", proveedor: "Facundo", proveedorNombre: "Fiestisima" }),
      fila({ rowId: "ok-2", proveedor: null }),
      fila({ rowId: "cruzada-2", proveedor: "GASTOS VARIOS", proveedorNombre: "Prosegur" }),
    ]);
    expect(plan.rowIdANulificar).toEqual(["cruzada-1", "cruzada-2"]);
  });
});
