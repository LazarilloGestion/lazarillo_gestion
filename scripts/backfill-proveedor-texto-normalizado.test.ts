import { describe, it, expect } from "vitest";
import { planBackfillProveedorTexto, type CompraParaBackfill } from "./backfill-proveedor-texto-normalizado";

describe("planBackfillProveedorTexto", () => {
  it("compra sin proveedorId y con texto: calcula el normalizado", () => {
    const compras: CompraParaBackfill[] = [{ rowId: "r1", proveedorId: null, proveedor: "Diego" }];
    const plan = planBackfillProveedorTexto(compras);
    expect(plan.actualizaciones).toEqual([{ rowId: "r1", proveedorTextoNormalizado: "diego" }]);
  });

  it("compra sin proveedorId y sin texto: cae a 'Sin Proveedor' normalizado", () => {
    const compras: CompraParaBackfill[] = [{ rowId: "r1", proveedorId: null, proveedor: null }];
    const plan = planBackfillProveedorTexto(compras);
    expect(plan.actualizaciones).toEqual([{ rowId: "r1", proveedorTextoNormalizado: "sinproveedor" }]);
  });

  it("compra con proveedorId real: no entra al plan (no se toca)", () => {
    const compras: CompraParaBackfill[] = [{ rowId: "r1", proveedorId: 5, proveedor: "Juan Perez" }];
    const plan = planBackfillProveedorTexto(compras);
    expect(plan.actualizaciones).toHaveLength(0);
  });

  it("dos textos crudos distintos: dos actualizaciones separadas", () => {
    const compras: CompraParaBackfill[] = [
      { rowId: "r1", proveedorId: null, proveedor: "Diego" },
      { rowId: "r2", proveedorId: null, proveedor: "GASTOS VARIOS" },
    ];
    const plan = planBackfillProveedorTexto(compras);
    expect(plan.actualizaciones).toHaveLength(2);
  });
});
