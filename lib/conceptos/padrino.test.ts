import { describe, it, expect } from "vitest";
import { reglasCopiadas } from "./padrino";

describe("padrino", () => {
  it("copia origen, vigencia y destinos con el código nuevo", () => {
    const [r] = reglasCopiadas([{
      origenLocalId: 1, origenPuntoDeVentaId: 2, modo: "desde_adelante", fechaDesde: new Date("2026-01-01"), fechaHasta: null, extremosInclusivos: true,
      destinos: [{ localId: 1, puntoDeVentaId: 2, porcentaje: "60" }, { localId: 1, puntoDeVentaId: 3, porcentaje: "40" }],
    }], "1004", "diego");
    expect(r.entidadId).toBe("1004");
    expect(r.nivel).toBe("concepto");
    expect(r.origenPuntoDeVenta).toEqual({ connect: { id: 2 } });
    expect(r.modo).toBe("desde_adelante");
    expect((r.destinos as { create: unknown[] }).create).toEqual([
      { local: { connect: { id: 1 } }, puntoDeVenta: { connect: { id: 2 } }, porcentaje: "60" },
      { local: { connect: { id: 1 } }, puntoDeVenta: { connect: { id: 3 } }, porcentaje: "40" },
    ]);
  });
  it("sin reglas no copia nada", () => {
    expect(reglasCopiadas([], "1000", null)).toEqual([]);
  });
});
