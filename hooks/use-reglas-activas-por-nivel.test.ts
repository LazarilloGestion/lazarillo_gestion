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

describe("computeReglasActivasPorNivel — vigencia (21/10/2026)", () => {
  const HOY = new Date("2026-10-21T00:00:00.000Z");
  const vencida = (over: Partial<ReglaAperturaDTO>) =>
    regla({ modo: "entre_fechas", fechaDesde: "2026-07-01T00:00:00.000Z", fechaHasta: "2026-09-30T00:00:00.000Z", ...over });

  it("una regla activa pero vencida NO cuenta como vigente y la entidad queda en `vencidas`", () => {
    const result = computeReglasActivasPorNivel([vencida({ nivel: "proveedor", entidadId: "p1" })], undefined, undefined, HOY);
    expect(result.proveedor.has("p1")).toBe(false);
    expect(result.vencidas.proveedor.has("p1")).toBe(true);
  });

  it("si la entidad tiene una vencida y otra vigente, cuenta como vigente y NO está en `vencidas`", () => {
    const reglas = [
      vencida({ id: 1, nivel: "proveedor", entidadId: "p1" }),
      regla({ id: 2, nivel: "proveedor", entidadId: "p1", modo: "desde_adelante", fechaDesde: "2026-10-01T00:00:00.000Z" }),
    ];
    const result = computeReglasActivasPorNivel(reglas, undefined, undefined, HOY);
    expect(result.proveedor.has("p1")).toBe(true);
    expect(result.vencidas.proveedor.has("p1")).toBe(false);
  });

  it("una regla próxima (arranca después de hoy) no es vigente ni vencida", () => {
    const reglas = [regla({ nivel: "concepto", entidadId: "c1", modo: "desde_adelante", fechaDesde: "2026-12-01T00:00:00.000Z" })];
    const result = computeReglasActivasPorNivel(reglas, undefined, undefined, HOY);
    expect(result.concepto.has("c1")).toBe(false);
    expect(result.vencidas.concepto.has("c1")).toBe(false);
  });

  it("una regla inactiva no entra en `vencidas` aunque su fecha haya pasado", () => {
    const result = computeReglasActivasPorNivel([vencida({ entidadId: "c1", estado: "inactiva" })], undefined, undefined, HOY);
    expect(result.vencidas.concepto.has("c1")).toBe(false);
  });

  it("`vencidas` respeta el filtro de local/pdv igual que las vigentes", () => {
    const result = computeReglasActivasPorNivel([vencida({ entidadId: "c1", origenLocalId: 2 })], 1, undefined, HOY);
    expect(result.vencidas.concepto.has("c1")).toBe(false);
  });
});
