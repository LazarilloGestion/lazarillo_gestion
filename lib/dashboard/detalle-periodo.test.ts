import { describe, it, expect } from "vitest";
import { periodoInicial, cambiarModo, navegar, labelPeriodo, aplicarPeriodo } from "./detalle-periodo";

const base = { year: 2026, localId: 1, pdvId: 1 };

describe("detalle-periodo (punto 2 Etapa 3)", () => {
  it("click en celda de mes → modo mes 'Julio 2026'; en Total → año; con meses parciales los respeta", () => {
    expect(labelPeriodo(periodoInicial({ ...base, mes: 7 }))).toBe("Julio 2026");
    expect(labelPeriodo(periodoInicial(base))).toBe("2026");
    expect(labelPeriodo(periodoInicial({ ...base, meses: [1, 2, 3] }))).toBe("Ene, Feb, Mar 2026");
  });

  it("flechas: mes cruza de año; año suma/resta; histórico no navega", () => {
    const jul = periodoInicial({ ...base, mes: 7 });
    expect(labelPeriodo(navegar(jul, 1))).toBe("Agosto 2026");
    expect(labelPeriodo(navegar(periodoInicial({ ...base, mes: 12 }), 1))).toBe("Enero 2027");
    expect(labelPeriodo(navegar(periodoInicial({ ...base, mes: 1 }), -1))).toBe("Diciembre 2025");
    expect(labelPeriodo(navegar(periodoInicial(base), -1))).toBe("2025");
    const hist = cambiarModo(jul, "historico");
    expect(navegar(hist, 1)).toBe(hist);
  });

  it("toggle: Año muestra el año completo (descarta meses parciales); Mes vuelve al mes guardado o al actual", () => {
    const parcial = periodoInicial({ ...base, meses: [1, 2, 3] });
    expect(labelPeriodo(cambiarModo(parcial, "anio"))).toBe("Ene, Feb, Mar 2026"); // mismo modo: no cambia
    const jul = periodoInicial({ ...base, mes: 7 });
    expect(labelPeriodo(cambiarModo(jul, "anio"))).toBe("2026");
    expect(labelPeriodo(cambiarModo(cambiarModo(jul, "anio"), "mes", new Date(2026, 9, 22)))).toBe("Octubre 2026");
    expect(labelPeriodo(cambiarModo(periodoInicial({ ...base, year: 2024 }), "mes", new Date(2026, 9, 22)))).toBe("Diciembre 2024");
    expect(labelPeriodo(cambiarModo(jul, "historico"))).toBe("Histórico");
  });

  it("aplicarPeriodo arma el filtro para la API según el modo", () => {
    const f = { ...base, mes: 7, rubroCodigo: "R1" };
    const p = periodoInicial(f);
    expect(aplicarPeriodo(f, navegar(p, 1))).toMatchObject({ year: 2026, mes: 8, rubroCodigo: "R1", historico: undefined });
    expect(aplicarPeriodo(f, cambiarModo(p, "anio"))).toMatchObject({ year: 2026, mes: undefined, meses: undefined });
    expect(aplicarPeriodo(f, cambiarModo(p, "historico"))).toMatchObject({ mes: undefined, meses: undefined, historico: true });
  });
});
