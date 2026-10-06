import { describe, it, expect } from "vitest";
import { agregarSinRubro, resolverVisibilidadSinRubro } from "./sin-rubro-config";
import { SIN_RUBRO_CODE, SIN_RUBRO_NOMBRE } from "./constants";

describe("resolverVisibilidadSinRubro", () => {
  it("sin fila usa el default: visible en Compras", () => {
    expect(resolverVisibilidadSinRubro(null, "visibleEnDashboard")).toBe(true);
  });

  it("sin fila usa el default: oculto en Resultados", () => {
    expect(resolverVisibilidadSinRubro(null, "visibleEnResultados")).toBe(false);
  });

  it("con fila respeta el valor guardado por vista", () => {
    const row = { visibleEnDashboard: false, visibleEnResultados: true };
    expect(resolverVisibilidadSinRubro(row, "visibleEnDashboard")).toBe(false);
    expect(resolverVisibilidadSinRubro(row, "visibleEnResultados")).toBe(true);
  });
});

describe("agregarSinRubro", () => {
  it("agrega Sin Rubro al final con el código sintético y no muta la lista original", () => {
    const base = [{ codigo: "1", nombre: "Alquiler", visible: true }];
    const out = agregarSinRubro(base, false);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ codigo: SIN_RUBRO_CODE, nombre: SIN_RUBRO_NOMBRE, visible: false });
    expect(base).toHaveLength(1);
  });
});
