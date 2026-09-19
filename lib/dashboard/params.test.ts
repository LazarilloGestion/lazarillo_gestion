import { describe, it, expect } from "vitest";
import { buildRangoAniosUrl, parseDashboardParams, buildDashboardUrl, buildComprasDetalleUrl } from "./params";

describe("buildRangoAniosUrl", () => {
  it("sin filtros: ruta sin query string", () => {
    expect(buildRangoAniosUrl()).toBe("/api/dashboard/rango-anios");
  });

  it("con localId: agrega localId", () => {
    expect(buildRangoAniosUrl(3)).toBe("/api/dashboard/rango-anios?localId=3");
  });

  it("con localId y pdvId: agrega ambos como puntoDeVentaId", () => {
    expect(buildRangoAniosUrl(3, 7)).toBe("/api/dashboard/rango-anios?localId=3&puntoDeVentaId=7");
  });

  it("pdvId sin localId: agrega solo puntoDeVentaId", () => {
    expect(buildRangoAniosUrl(undefined, 7)).toBe("/api/dashboard/rango-anios?puntoDeVentaId=7");
  });
});

describe("parseDashboardParams — agrupacion", () => {
  it("sin agrupacion en la URL: undefined (default concepto)", () => {
    const params = parseDashboardParams(new URLSearchParams());
    expect(params.agrupacion).toBeUndefined();
  });

  it("agrupacion=proveedor: se parsea", () => {
    const params = parseDashboardParams(new URLSearchParams("agrupacion=proveedor"));
    expect(params.agrupacion).toBe("proveedor");
  });

  it("valor inválido: undefined, no rompe", () => {
    const params = parseDashboardParams(new URLSearchParams("agrupacion=lo-que-sea"));
    expect(params.agrupacion).toBeUndefined();
  });
});

describe("buildComprasDetalleUrl — sinProveedor", () => {
  it("con proveedorId: agrega proveedorId, no sinProveedor", () => {
    const url = buildComprasDetalleUrl({ year: 2026, proveedorId: 5 });
    expect(url).toContain("proveedorId=5");
    expect(url).not.toContain("sinProveedor");
  });

  it("con sinProveedor: agrega sinProveedor=1, no proveedorId", () => {
    const url = buildComprasDetalleUrl({ year: 2026, sinProveedor: true });
    expect(url).toContain("sinProveedor=1");
    expect(url).not.toContain("proveedorId");
  });

  it("sin proveedorId ni sinProveedor: no agrega ninguno de los dos", () => {
    const url = buildComprasDetalleUrl({ year: 2026 });
    expect(url).not.toContain("proveedorId");
    expect(url).not.toContain("sinProveedor");
  });
});

describe("buildDashboardUrl — agrupacion", () => {
  it("sin agrupacion: no agrega el parámetro (default concepto)", () => {
    const url = buildDashboardUrl("/api/dashboard/pivot", { year: 2026 });
    expect(url).not.toContain("agrupacion");
  });

  it("agrupacion proveedor: se agrega a la query", () => {
    const url = buildDashboardUrl("/api/dashboard/pivot", { year: 2026, agrupacion: "proveedor" });
    expect(url).toContain("agrupacion=proveedor");
  });
});
