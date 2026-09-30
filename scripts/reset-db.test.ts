import { describe, it, expect } from "vitest";
import { planReset } from "./reset-db";

describe("planReset", () => {
  it("sin overrides, sin distribuciones, sin reglas: no bloquea", () => {
    const plan = planReset({ overridesCompras: 0, overridesVentas: 0, distribuciones: 0, reglas: 0 });
    expect(plan).toEqual({ debeBloquear: false, motivos: [] });
  });

  it("con overrides en compras: bloquea con el motivo correspondiente", () => {
    const plan = planReset({ overridesCompras: 3, overridesVentas: 0, distribuciones: 0, reglas: 0 });
    expect(plan.debeBloquear).toBe(true);
    expect(plan.motivos).toEqual(["overrides manuales en compras/ventas"]);
  });

  it("con overrides en ventas: bloquea con el mismo motivo (no duplica overrides de compras)", () => {
    const plan = planReset({ overridesCompras: 0, overridesVentas: 2, distribuciones: 0, reglas: 0 });
    expect(plan.debeBloquear).toBe(true);
    expect(plan.motivos).toEqual(["overrides manuales en compras/ventas"]);
  });

  it("con distribuciones de apertura (plata ya distribuida): bloquea — hallazgo real, hoy se borra en silencio", () => {
    const plan = planReset({ overridesCompras: 0, overridesVentas: 0, distribuciones: 5, reglas: 0 });
    expect(plan.debeBloquear).toBe(true);
    expect(plan.motivos).toEqual(["distribuciones de apertura (dinero ya distribuido)"]);
  });

  it("con reglas de apertura: bloquea — hallazgo real, hoy sobreviven al reset y se reaplican solas", () => {
    const plan = planReset({ overridesCompras: 0, overridesVentas: 0, distribuciones: 0, reglas: 4 });
    expect(plan.debeBloquear).toBe(true);
    expect(plan.motivos).toEqual(["reglas de apertura activas"]);
  });

  it("con las 4 categorías presentes: bloquea y lista los 3 motivos (overrides cuenta una sola vez)", () => {
    const plan = planReset({ overridesCompras: 1, overridesVentas: 1, distribuciones: 1, reglas: 1 });
    expect(plan.debeBloquear).toBe(true);
    expect(plan.motivos).toEqual([
      "overrides manuales en compras/ventas",
      "distribuciones de apertura (dinero ya distribuido)",
      "reglas de apertura activas",
    ]);
  });
});
