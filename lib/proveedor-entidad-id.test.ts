import { describe, it, expect } from "vitest";
import { construirEntidadIdProveedorTexto, parsearEntidadIdProveedorTexto, candidatosEntidadIdProveedor } from "./proveedor-entidad-id";

describe("construirEntidadIdProveedorTexto", () => {
  it("sin codigo: solo texto:<normalizado>", () => {
    expect(construirEntidadIdProveedorTexto("diego", null)).toBe("texto:diego");
  });
  it("con codigo: agrega el sufijo", () => {
    expect(construirEntidadIdProveedorTexto("abril", "368")).toBe("texto:abril|codigo:368");
  });
  it("sinproveedor: nunca lleva sufijo aunque haya codigo", () => {
    expect(construirEntidadIdProveedorTexto("sinproveedor", "999")).toBe("texto:sinproveedor");
  });
});

describe("parsearEntidadIdProveedorTexto", () => {
  it("no empieza con texto:: null", () => {
    expect(parsearEntidadIdProveedorTexto("123")).toBeNull();
  });
  it("sin sufijo de codigo", () => {
    expect(parsearEntidadIdProveedorTexto("texto:diego")).toEqual({ normalizado: "diego", codigo: null });
  });
  it("con sufijo de codigo", () => {
    expect(parsearEntidadIdProveedorTexto("texto:abril|codigo:368")).toEqual({ normalizado: "abril", codigo: "368" });
  });
});

describe("round-trip construir -> parsear", () => {
  it("con codigo vuelve exactamente al mismo normalizado/codigo", () => {
    const clave = construirEntidadIdProveedorTexto("agustina", "550");
    expect(parsearEntidadIdProveedorTexto(clave)).toEqual({ normalizado: "agustina", codigo: "550" });
  });
  it("sin codigo vuelve exactamente al mismo normalizado, codigo null", () => {
    const clave = construirEntidadIdProveedorTexto("gastosvarios", null);
    expect(parsearEntidadIdProveedorTexto(clave)).toEqual({ normalizado: "gastosvarios", codigo: null });
  });
});

describe("candidatosEntidadIdProveedor", () => {
  it("proveedorId real (no texto:): un solo candidato, sin variantes", () => {
    expect(candidatosEntidadIdProveedor("123")).toEqual(["123"]);
  });
  it("texto: sin codigo: un solo candidato", () => {
    expect(candidatosEntidadIdProveedor("texto:diego")).toEqual(["texto:diego"]);
  });
  it("texto: con codigo: el específico primero, la base vieja como fallback", () => {
    expect(candidatosEntidadIdProveedor("texto:abril|codigo:368")).toEqual(["texto:abril|codigo:368", "texto:abril"]);
  });
});
