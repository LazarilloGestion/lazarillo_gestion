import { describe, it, expect } from "vitest";
import { filtroFilaProveedor } from "./filtro-fila-proveedor";

const base = { proveedorId: null, proveedorTexto: null, codigo: null, rubroCodigo: "R1" };

describe("filtroFilaProveedor", () => {
  it("proveedor real: filtra por su id dentro del rubro de la fila", () => {
    expect(filtroFilaProveedor({ ...base, proveedorId: 7 })).toEqual({ proveedorId: 7, rubroCodigo: "R1" });
  });

  it("proveedor de texto: filtra por texto y código dentro del rubro de la fila", () => {
    expect(filtroFilaProveedor({ ...base, proveedorTexto: "Abril", codigo: "368" })).toEqual({
      proveedorTexto: "Abril",
      codigo: "368",
      rubroCodigo: "R1",
    });
  });

  it("proveedor de texto sin código: no manda código", () => {
    expect(filtroFilaProveedor({ ...base, proveedorTexto: "Abril" })).toEqual({
      proveedorTexto: "Abril",
      codigo: undefined,
      rubroCodigo: "R1",
    });
  });

  it("sin proveedor: filtra las compras sin proveedor dentro del rubro de la fila", () => {
    expect(filtroFilaProveedor(base)).toEqual({ sinProveedor: true, rubroCodigo: "R1" });
  });

  it("bajo Sin Rubro: manda el código sintético que la API del detalle entiende", () => {
    expect(filtroFilaProveedor({ ...base, proveedorId: 7, rubroCodigo: "__sin_rubro" })).toEqual({
      proveedorId: 7,
      rubroCodigo: "__sin_rubro",
    });
  });
});
