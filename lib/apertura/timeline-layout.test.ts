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

  // Regresiones de la revisión final de rama (Fase C): el modal arma una entrada
  // "nueva" sintética con el estado EN CURSO del formulario, así que la función
  // recibe rutinariamente reglas cuyo modo exige una fecha que el usuario todavía
  // no tipeó. Antes reventaba con TypeError por los non-null assertions.
  describe("reglas con vigencia incompleta (formulario a medio llenar)", () => {
    it("entre_fechas con solo fechaDesde: no explota y devuelve segmento incompleto", () => {
      const result = calcularSegmentosTimeline([
        { id: "nueva", estado: "nueva", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: null },
      ]);
      expect(result).toEqual([
        { id: "nueva", estado: "nueva", leftPct: 0, widthPct: 0, fadeInicio: false, fadeFin: false, label: "Vigencia incompleta" },
      ]);
    });

    it("regla fechada existente + regla nueva sin fechas: la existente se dibuja, la nueva queda incompleta", () => {
      const result = calcularSegmentosTimeline([
        { id: 1, estado: "activa", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-03-31") },
        { id: "nueva", estado: "nueva", modo: "entre_fechas", fechaDesde: null, fechaHasta: null },
      ]);
      expect(result[0].label).toBe("01/01/2026 — 31/03/2026");
      expect(result[0].widthPct).toBeGreaterThan(0);
      expect(result[1]).toEqual({
        id: "nueva", estado: "nueva", leftPct: 0, widthPct: 0, fadeInicio: false, fadeFin: false, label: "Vigencia incompleta",
      });
    });

    it("regla fechada existente + desde_adelante sin fecha: no explota", () => {
      const result = calcularSegmentosTimeline([
        { id: 1, estado: "activa", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-03-31") },
        { id: "nueva", estado: "nueva", modo: "desde_adelante", fechaDesde: null, fechaHasta: null },
      ]);
      expect(result[1].label).toBe("Vigencia incompleta");
    });

    it("desde_atras sin fechaHasta: no explota", () => {
      const result = calcularSegmentosTimeline([
        { id: "nueva", estado: "nueva", modo: "desde_atras", fechaDesde: null, fechaHasta: null },
      ]);
      expect(result[0].label).toBe("Vigencia incompleta");
    });

    it("una regla no-historico sin fechas NO se etiqueta 'Histórico completo'", () => {
      const [seg] = calcularSegmentosTimeline([
        { id: "nueva", estado: "nueva", modo: "desde_adelante", fechaDesde: null, fechaHasta: null },
      ]);
      expect(seg.label).not.toBe("Histórico completo");
      expect(seg.widthPct).toBe(0);
    });

    it("historico convive con reglas fechadas: sigue ocupando el 100% del ancho", () => {
      const result = calcularSegmentosTimeline([
        { id: 1, estado: "activa", modo: "historico", fechaDesde: null, fechaHasta: null },
        { id: 2, estado: "activa", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-03-31") },
      ]);
      expect(result[0]).toEqual({
        id: 1, estado: "activa", leftPct: 0, widthPct: 100, fadeInicio: false, fadeFin: false, label: "Histórico completo",
      });
    });

    it("una regla incompleta no aporta fechas al eje temporal", () => {
      const soloCompleta = calcularSegmentosTimeline([
        { id: 1, estado: "activa", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-03-31") },
      ]);
      const conIncompleta = calcularSegmentosTimeline([
        { id: 1, estado: "activa", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-03-31") },
        { id: "nueva", estado: "nueva", modo: "entre_fechas", fechaDesde: new Date("2020-01-01"), fechaHasta: null },
      ]);
      expect(conIncompleta[0].leftPct).toBeCloseTo(soloCompleta[0].leftPct, 5);
      expect(conIncompleta[0].widthPct).toBeCloseTo(soloCompleta[0].widthPct, 5);
    });
  });
});
