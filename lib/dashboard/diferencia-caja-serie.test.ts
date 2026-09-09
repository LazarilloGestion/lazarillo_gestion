import { describe, it, expect } from "vitest";
import { buildDiferenciaCajaSerie, type TotalesAnio } from "./diferencia-caja-serie";

// Helper: arma un TotalesAnio con los mismos números en todos los meses salvo overrides.
function totales(over: Partial<{
  ingresos: Record<number, number>;
  egresos: Record<number, number>;
  ganancia: Record<number, number>;
  disponible: Record<number, number | null>;
}> = {}): TotalesAnio {
  return {
    ingresosPorMes: over.ingresos ?? {},
    egresosPorMes: over.egresos ?? {},
    gananciaPorMes: over.ganancia ?? {},
    disponiblePorMes: over.disponible ?? {},
  };
}

describe("buildDiferenciaCajaSerie", () => {
  it("sin primer arqueo → los 12 meses en null", () => {
    const out = buildDiferenciaCajaSerie({ year: 2025, primerArqueo: null, totalesPorAnio: {} });
    expect(Object.keys(out)).toHaveLength(12);
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });

  it("primer arqueo en un año posterior al pedido → los 12 meses en null", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2024,
      primerArqueo: { anio: 2025, mes: 3 },
      totalesPorAnio: {},
    });
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });

  it("un solo año: meses <= primer arqueo en null, mes con arqueo posterior con valor", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2025,
      primerArqueo: { anio: 2025, mes: 3 },
      totalesPorAnio: {
        2025: totales({
          ingresos: { 3: 100, 4: 120 },
          egresos: { 3: 40, 4: 50 },
          ganancia: { 3: 20, 4: 30 },
          disponible: { 3: 500, 4: 600 },
        }),
      },
    });
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect(out[3]).toBeNull(); // mes del primer arqueo
    // abr: delta = 600 - 500 = 100; contable = (120-50)-30 = 40; acc = 100 - 40 = 60
    expect(out[4]).toBe(60);
    expect(out[5]).toBeNull(); // sin datos → sin arqueo → null
  });

  it("cross-año: primer arqueo en 2025, se pide 2026 → recorta al año pedido con el offset correcto", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2026,
      primerArqueo: { anio: 2025, mes: 12 },
      totalesPorAnio: {
        2025: totales({ disponible: { 12: 1000 } }),
        2026: totales({
          ingresos: { 1: 120, 2: 110 },
          egresos: { 1: 50, 2: 45 },
          ganancia: { 1: 30, 2: 25 },
          disponible: { 2: 900 },
        }),
      },
    });
    // ene 2026: sin arqueo propio → null
    expect(out[1]).toBeNull();
    // feb 2026: delta = 900 - 1000 = -100; contable ene = (120-50)-30 = 40; contable feb = (110-45)-25 = 40
    // acc ene = 0 - 40 = -40; acc feb = -40 + (-100 - 40) = -180
    expect(out[2]).toBe(-180);
  });

  it("año faltante en totalesPorAnio se trata como año vacío (no rompe)", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2026,
      primerArqueo: { anio: 2025, mes: 1 },
      totalesPorAnio: { 2025: totales({ disponible: { 1: 1000 } }) }, // falta 2026
    });
    expect(Object.keys(out)).toHaveLength(12);
    expect(out[1]).toBeNull();
  });
});
