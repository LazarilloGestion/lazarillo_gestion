// lib/apertura/timeline-layout.test.ts
import { describe, it, expect } from "vitest";
import { calcularSegmentosTimeline } from "./timeline-layout";

describe("calcularSegmentosTimeline", () => {
  it("todas historico: cada regla ocupa el 100% del ancho, sin fade", () => {
    const result = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "historico", fechaDesde: null, fechaHasta: null },
      { id: 2, estado: "inactiva", modo: "historico", fechaDesde: null, fechaHasta: null },
    ]);
    expect(result).toEqual([
      { id: 1, estado: "activa", leftPct: 0, widthPct: 100, fadeInicio: false, fadeFin: false, label: "Histórico completo" },
      { id: 2, estado: "inactiva", leftPct: 0, widthPct: 100, fadeInicio: false, fadeFin: false, label: "Histórico completo" },
    ]);
  });

  it("entre_fechas: el segmento cae dentro de (0,100), sin fade, con label de rango", () => {
    const [seg] = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-01-31") },
    ]);
    expect(seg.leftPct).toBeGreaterThan(0);
    expect(seg.leftPct).toBeLessThan(100);
    expect(seg.widthPct).toBeGreaterThan(0);
    expect(seg.fadeInicio).toBe(false);
    expect(seg.fadeFin).toBe(false);
    expect(seg.label).toBe("01/01/2026 — 31/01/2026");
  });

  it("desde_adelante: llega hasta el borde derecho (leftPct+widthPct = 100) con fade de fin", () => {
    const [seg] = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "desde_adelante", fechaDesde: new Date("2026-01-01"), fechaHasta: null },
    ]);
    expect(seg.leftPct + seg.widthPct).toBeCloseTo(100, 5);
    expect(seg.fadeFin).toBe(true);
    expect(seg.fadeInicio).toBe(false);
  });

  it("desde_atras: arranca en el borde izquierdo (leftPct=0) con fade de inicio", () => {
    const [seg] = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "desde_atras", fechaDesde: null, fechaHasta: new Date("2026-06-30") },
    ]);
    expect(seg.leftPct).toBe(0);
    expect(seg.fadeInicio).toBe(true);
    expect(seg.fadeFin).toBe(false);
  });

  it("mezcla de modos: cada segmento conserva el id/estado de su regla, en el mismo orden de entrada", () => {
    const result = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-03-31") },
      { id: "nueva", estado: "nueva", modo: "desde_adelante", fechaDesde: new Date("2026-04-01"), fechaHasta: null },
    ]);
    expect(result.map((s) => s.id)).toEqual([1, "nueva"]);
    expect(result[1].estado).toBe("nueva");
  });

  it("lista vacía devuelve lista vacía", () => {
    expect(calcularSegmentosTimeline([])).toEqual([]);
  });
});
