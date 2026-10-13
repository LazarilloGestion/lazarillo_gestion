import { describe, it, expect } from "vitest";
import { elegirReglaParaCompra, resolverEntidadIdProveedor, type ReglaCandidata } from "./reevaluacion";

const reglaRamosAlquiler: ReglaCandidata = {
  id: 1, modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true,
  origenLocalId: 1, origenPuntoDeVentaId: 10, destinos: [{ id: 100, porcentaje: 100 }],
};
const reglaSanJustoEne: ReglaCandidata = {
  id: 2, modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-01-31"), extremosInclusivos: true,
  origenLocalId: 2, origenPuntoDeVentaId: null, destinos: [{ id: 200, porcentaje: 100 }],
};

describe("elegirReglaParaCompra", () => {
  it("elige la regla cuyo origen alcanza la compra y cuya vigencia cubre la fecha", () => {
    const r = elegirReglaParaCompra({ localId: 1, puntoDeVentaId: 10 }, new Date("2026-05-01"), [reglaRamosAlquiler, reglaSanJustoEne]);
    expect(r?.id).toBe(1);
  });
  it("no elige una regla de otro origen", () => {
    const r = elegirReglaParaCompra({ localId: 2, puntoDeVentaId: 20 }, new Date("2026-05-01"), [reglaRamosAlquiler]);
    expect(r).toBeNull();
  });
  it("no elige una regla cuya vigencia no cubre la fecha", () => {
    const r = elegirReglaParaCompra({ localId: 2, puntoDeVentaId: 20 }, new Date("2026-05-01"), [reglaSanJustoEne]);
    expect(r).toBeNull();
  });
  it("compra sin local: ninguna regla", () => {
    const r = elegirReglaParaCompra({ localId: null, puntoDeVentaId: null }, new Date("2026-01-15"), [reglaRamosAlquiler, reglaSanJustoEne]);
    expect(r).toBeNull();
  });
});

describe("resolverEntidadIdProveedor", () => {
  it("proveedorId presente: usa el id numérico como string, sin importar el código", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: 5, proveedor: "Juan Perez", codigo: "999" })).toBe("5");
  });

  it("proveedorId null con texto crudo y codigo: usa 'texto:<normalizado>|codigo:<codigo>'", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Diego", codigo: "120" })).toBe("texto:diego|codigo:120");
  });

  it("proveedorId null con texto crudo pero SIN codigo: usa 'texto:<normalizado>' sin sufijo, igual que antes", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Diego", codigo: null })).toBe("texto:diego");
  });

  it("proveedorId null y sin texto: cae a 'texto:sinproveedor', sin codigo", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: null, codigo: null })).toBe("texto:sinproveedor");
  });

  it("proveedorId null, sin texto, CON codigo: sigue siendo 'texto:sinproveedor' sin sufijo — no es una identidad real a desambiguar", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: null, codigo: "999" })).toBe("texto:sinproveedor");
  });

  it("GASTOS VARIOS con codigo: 'texto:gastosvarios' sin sufijo — mismo nodo que arma el pivot", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: "GASTOS VARIOS", codigo: "101" })).toBe("texto:gastosvarios");
  });

  it("dos personas con mismo nombre y codigo distinto resuelven a entidadId distinto", () => {
    const a = resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Abril", codigo: "368" });
    const b = resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Abril", codigo: "670" });
    expect(a).not.toBe(b);
  });
});
