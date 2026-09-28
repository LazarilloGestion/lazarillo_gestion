import { describe, it, expect } from "vitest";
import { compararPrioridadNivel, condicionMatchNivel } from "./motor";

describe("compararPrioridadNivel", () => {
  it("registro va antes que proveedor", () => {
    expect(compararPrioridadNivel({ nivel: "registro" }, { nivel: "proveedor" })).toBeLessThan(0);
  });
  it("proveedor va antes que concepto", () => {
    expect(compararPrioridadNivel({ nivel: "proveedor" }, { nivel: "concepto" })).toBeLessThan(0);
  });
  it("registro va antes que concepto", () => {
    expect(compararPrioridadNivel({ nivel: "registro" }, { nivel: "concepto" })).toBeLessThan(0);
  });
  it("mismo nivel es equivalente", () => {
    expect(compararPrioridadNivel({ nivel: "concepto" }, { nivel: "concepto" })).toBe(0);
  });
});

describe("condicionMatchNivel", () => {
  it("nivel proveedor con entidadId numérico: compara contra proveedorId, como hoy", () => {
    const cond = condicionMatchNivel("proveedor", "123");
    expect(cond.sql).toContain('"proveedorId"::text = ?');
    expect(cond.values).toEqual(["123"]);
  });

  it("nivel proveedor con entidadId 'texto:<normalizado>': compara contra proveedorTextoNormalizado con proveedorId IS NULL", () => {
    const cond = condicionMatchNivel("proveedor", "texto:diego");
    expect(cond.sql).toContain('"proveedorId" IS NULL');
    expect(cond.sql).toContain('"proveedorTextoNormalizado" = ?');
    expect(cond.values).toEqual(["diego"]);
  });

  it("nivel proveedor con entidadId 'texto:sinproveedor' (nodo genuino Sin Proveedor)", () => {
    const cond = condicionMatchNivel("proveedor", "texto:sinproveedor");
    expect(cond.values).toEqual(["sinproveedor"]);
  });

  it("nivel concepto no se ve afectado por el prefijo 'texto:'", () => {
    const cond = condicionMatchNivel("concepto", "GASTO1");
    expect(cond.sql).toContain('"conceptoCodigoManual"');
    expect(cond.values).toEqual(["GASTO1"]);
  });

  it("nivel proveedor con entidadId 'texto:<normalizado>|codigo:<codigo>': agrega AND sobre c.codigo", () => {
    const cond = condicionMatchNivel("proveedor", "texto:abril|codigo:368");
    expect(cond.sql).toContain('"proveedorId" IS NULL');
    expect(cond.sql).toContain('"proveedorTextoNormalizado" = ?');
    expect(cond.sql).toContain('"codigo" = ?');
    expect(cond.values).toEqual(["abril", "368"]);
  });

  it("nivel proveedor con entidadId 'texto:<normalizado>' sin codigo: comportamiento sin cambios", () => {
    const cond = condicionMatchNivel("proveedor", "texto:diego");
    expect(cond.sql).not.toContain('"codigo" = ?');
    expect(cond.values).toEqual(["diego"]);
  });
});
