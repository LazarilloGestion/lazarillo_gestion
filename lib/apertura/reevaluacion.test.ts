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
  it("proveedorId presente: usa el id numérico como string", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: 5, proveedor: "Juan Perez" })).toBe("5");
  });

  it("proveedorId null con texto crudo: usa 'texto:<normalizado>'", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Diego" })).toBe("texto:diego");
  });

  it("proveedorId null y sin texto: cae a 'texto:sinproveedor'", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: null })).toBe("texto:sinproveedor");
  });
});
