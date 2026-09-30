import { describe, it, expect } from "vitest";
import { computeReglasActivasPorNivel } from "./use-reglas-activas-por-nivel";
import type { ReglaAperturaDTO } from "@/lib/apertura/types";

function regla(overrides: Partial<ReglaAperturaDTO>): ReglaAperturaDTO {
  return {
    id: 1,
    nivel: "concepto",
    entidadId: "concepto-1",
    origenLocalId: 1,
    origenPuntoDeVentaId: null,
    modo: "historico",
    fechaDesde: null,
    fechaHasta: null,
    extremosInclusivos: true,
    estado: "activa",
    creadoPor: null,
    creadoEn: "2026-01-01T00:00:00.000Z",
    destinos: [],
    ...overrides,
  };
}

describe("computeReglasActivasPorNivel", () => {
  it("separa reglas activas por nivel (concepto/proveedor/registro)", () => {
    const reglas = [
      regla({ nivel: "concepto", entidadId: "c1" }),
      regla({ nivel: "proveedor", entidadId: "p1" }),
      regla({ nivel: "registro", entidadId: "r1" }),
    ];
    const result = computeReglasActivasPorNivel(reglas, undefined, undefined);
    expect(result.concepto.has("c1")).toBe(true);
    expect(result.proveedor.has("p1")).toBe(true);
    expect(result.registro.has("r1")).toBe(true);
  });

  it("descarta reglas inactivas", () => {
    const reglas = [regla({ estado: "inactiva", entidadId: "c1" })];
    const result = computeReglasActivasPorNivel(reglas, undefined, undefined);
    expect(result.concepto.has("c1")).toBe(false);
  });

  it("sin filtro de local/pdv: todas las reglas activas alcanzan", () => {
    const reglas = [regla({ origenLocalId: 5, entidadId: "c1" })];
    const result = computeReglasActivasPorNivel(reglas, undefined, undefined);
    expect(result.concepto.has("c1")).toBe(true);
  });

  it("con filtro de local: solo alcanzan reglas con ese origenLocalId", () => {
    const reglas = [
      regla({ origenLocalId: 1, entidadId: "del-local-1" }),
      regla({ origenLocalId: 2, entidadId: "del-local-2" }),
    ];
    const result = computeReglasActivasPorNivel(reglas, 1, undefined);
    expect(result.concepto.has("del-local-1")).toBe(true);
    expect(result.concepto.has("del-local-2")).toBe(false);
  });

  it("con filtro de pdv: regla de \"todo el local\" alcanza igual (origenAlcanza)", () => {
    const reglas = [regla({ origenLocalId: 1, origenPuntoDeVentaId: null, entidadId: "c1" })];
    const result = computeReglasActivasPorNivel(reglas, 1, 7);
    expect(result.concepto.has("c1")).toBe(true);
  });

  it("con filtro de pdv: regla de otro pdv puntual no alcanza", () => {
    const reglas = [regla({ origenLocalId: 1, origenPuntoDeVentaId: 3, entidadId: "c1" })];
    const result = computeReglasActivasPorNivel(reglas, 1, 7);
    expect(result.concepto.has("c1")).toBe(false);
  });
});
