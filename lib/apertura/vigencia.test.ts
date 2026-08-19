import { describe, it, expect } from "vitest";
import { resolverVigencia, type ReglaVigencia } from "./vigencia";

describe("resolverVigencia", () => {
  it("historico: no requiere fechas, siempre matchea", () => {
    const regla: ReglaVigencia = { modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
    expect(resolverVigencia(regla)).toEqual({ tipo: "historico" });
  });

  it("entre_fechas: propaga desde/hasta/inclusivo", () => {
    const desde = new Date("2026-01-01");
    const hasta = new Date("2026-01-31");
    const regla: ReglaVigencia = { modo: "entre_fechas", fechaDesde: desde, fechaHasta: hasta, extremosInclusivos: false };
    expect(resolverVigencia(regla)).toEqual({ tipo: "entre_fechas", desde, hasta, inclusivo: false });
  });

  it("entre_fechas sin fechaDesde: lanza error explícito (nunca silencioso)", () => {
    const regla: ReglaVigencia = {
      modo: "entre_fechas",
      fechaDesde: null,
      fechaHasta: new Date("2026-01-31"),
      extremosInclusivos: true,
    };
    expect(() => resolverVigencia(regla)).toThrow(/fechaDesde/);
  });

  it("entre_fechas sin fechaHasta: lanza error explícito", () => {
    const regla: ReglaVigencia = {
      modo: "entre_fechas",
      fechaDesde: new Date("2026-01-01"),
      fechaHasta: null,
      extremosInclusivos: true,
    };
    expect(() => resolverVigencia(regla)).toThrow(/fechaHasta/);
  });

  it("desde_adelante: requiere solo fechaDesde", () => {
    const desde = new Date("2026-06-01");
    const regla: ReglaVigencia = { modo: "desde_adelante", fechaDesde: desde, fechaHasta: null, extremosInclusivos: true };
    expect(resolverVigencia(regla)).toEqual({ tipo: "desde_adelante", desde, inclusivo: true });
  });

  it("desde_adelante sin fechaDesde: lanza error", () => {
    const regla: ReglaVigencia = { modo: "desde_adelante", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
    expect(() => resolverVigencia(regla)).toThrow(/fechaDesde/);
  });

  it("desde_atras: requiere solo fechaHasta", () => {
    const hasta = new Date("2026-03-01");
    const regla: ReglaVigencia = { modo: "desde_atras", fechaDesde: null, fechaHasta: hasta, extremosInclusivos: false };
    expect(resolverVigencia(regla)).toEqual({ tipo: "desde_atras", hasta, inclusivo: false });
  });

  it("desde_atras sin fechaHasta: lanza error", () => {
    const regla: ReglaVigencia = { modo: "desde_atras", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
    expect(() => resolverVigencia(regla)).toThrow(/fechaHasta/);
  });
});
