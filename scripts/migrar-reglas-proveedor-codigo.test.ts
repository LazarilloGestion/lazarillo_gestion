import { describe, it, expect } from "vitest";
import { decidirMigracionRegla, planificarMigracionReglas, type ReglaCandidata } from "./migrar-reglas-proveedor-codigo";

function reglaCandidata(overrides: Partial<ReglaCandidata>): ReglaCandidata {
  return {
    id: 1,
    entidadId: "texto:diego",
    destinos: [{ localId: 1, puntoDeVentaId: 1, porcentaje: 100 }],
    vigencia: { modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true },
    origen: { origenLocalId: 1, origenPuntoDeVentaId: null },
    codigos: [],
    ...overrides,
  };
}

describe("decidirMigracionRegla", () => {
  it("sin distribuciones propias: omitir, no hay evidencia de qué código usar", () => {
    const decision = decidirMigracionRegla(reglaCandidata({ id: 42, codigos: [] }));
    expect(decision).toEqual({ tipo: "omitir", reglaId: 42, razon: "la regla no tiene compras ya distribuidas — no hay evidencia de qué código usar" });
  });

  it("un solo código entre sus distribuciones: renombrar, con el sufijo de ese código", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 204, entidadId: "texto:jorge",
      codigos: [{ codigo: "506", cantidadCompras: 78, totalDistribuido: 2181710 }],
    }));
    expect(decision).toEqual({ tipo: "renombrar", reglaId: 204, entidadIdNuevo: "texto:jorge|codigo:506" });
  });

  it("dos codigos distintos entre sus distribuciones: dividir, uno por código", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 175, entidadId: "texto:camila",
      codigos: [
        { codigo: "597", cantidadCompras: 127, totalDistribuido: 30000310 },
        { codigo: "660", cantidadCompras: 33, totalDistribuido: 4385131 },
      ],
    }));
    expect(decision).toEqual({ tipo: "dividir", reglaId: 175, codigosNuevos: ["597", "660"] });
  });

  it("tres codigos distintos (Franco): dividir en 3", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 200, entidadId: "texto:franco",
      codigos: [
        { codigo: "439", cantidadCompras: 4, totalDistribuido: 6600 },
        { codigo: "532", cantidadCompras: 2, totalDistribuido: 8860 },
        { codigo: "685", cantidadCompras: 40, totalDistribuido: 3999250 },
      ],
    }));
    expect(decision).toEqual({ tipo: "dividir", reglaId: 200, codigosNuevos: ["439", "532", "685"] });
  });

  it("Lucas ventana 1 (id 186): un solo código en ESTA regla puntual, aunque el nombre tenga más códigos en otras ventanas de vigencia", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 186, entidadId: "texto:lucas",
      codigos: [{ codigo: "638", cantidadCompras: 18, totalDistribuido: 3630350 }],
    }));
    expect(decision).toEqual({ tipo: "renombrar", reglaId: 186, entidadIdNuevo: "texto:lucas|codigo:638" });
  });

  it("Lucas ventana 2 (id 187): dos códigos en ESTA regla puntual, distinto del resultado de la ventana 1", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 187, entidadId: "texto:lucas",
      codigos: [
        { codigo: "543", cantidadCompras: 1, totalDistribuido: 3890 },
        { codigo: "638", cantidadCompras: 16, totalDistribuido: 3116700 },
      ],
    }));
    expect(decision).toEqual({ tipo: "dividir", reglaId: 187, codigosNuevos: ["543", "638"] });
  });
});

describe("planificarMigracionReglas", () => {
  it("aplica decidirMigracionRegla a cada regla, preservando el orden", () => {
    const reglas = [
      reglaCandidata({ id: 1, entidadId: "texto:diego", codigos: [{ codigo: "120", cantidadCompras: 5, totalDistribuido: 1000 }] }),
      reglaCandidata({ id: 2, entidadId: "texto:sinnombre", codigos: [] }),
    ];
    const decisiones = planificarMigracionReglas(reglas);
    expect(decisiones).toHaveLength(2);
    expect(decisiones[0]).toEqual({ tipo: "renombrar", reglaId: 1, entidadIdNuevo: "texto:diego|codigo:120" });
    expect(decisiones[1].tipo).toBe("omitir");
  });
});
