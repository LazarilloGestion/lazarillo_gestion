import { describe, it, expect } from "vitest";
import { proyectarMes, debeProyectar, fmtMillones, type VentaDia } from "./proyeccion";

// Serie sintética: cada día vende según su día de semana × factor del mes.
const BASE_DOW = [200, 100, 100, 100, 150, 400, 500]; // dom..sáb
function serie(desde: string, hasta: string, factor: (fecha: string) => number = () => 1): VentaDia[] {
  const out: VentaDia[] = [];
  for (let ms = Date.parse(desde + "T00:00:00Z"); ms <= Date.parse(hasta + "T00:00:00Z"); ms += 86_400_000) {
    const f = new Date(ms).toISOString().slice(0, 10);
    out.push({ fecha: f, total: BASE_DOW[new Date(ms).getUTCDay()] * factor(f) });
  }
  return out;
}
const sumaMes = (d: VentaDia[], prefijo: string) => d.filter((x) => x.fecha.startsWith(prefijo)).reduce((a, b) => a + b.total, 0);

describe("proyectarMes", () => {
  it("con ventas regulares acierta el cierre exacto y el ritmo es 1", () => {
    const todo = serie("2025-09-01", "2026-10-31");
    const hasta21 = todo.filter((d) => d.fecha <= "2026-10-21");
    const r = proyectarMes(hasta21, "2026-10-21")!;
    expect(r.mes).toBe(10);
    expect(r.diasTranscurridos).toBe(21);
    expect(r.diasRestantes).toBe(10);
    expect(r.ritmo).toBeCloseTo(1, 6);
    expect(r.proyeccion).toBeCloseTo(sumaMes(todo, "2026-10"), 6);
    expect(r.backtest?.meses).toBe(6);
    expect(r.backtest?.errorMetodo).toBeCloseTo(0, 6);
  });

  it("el ritmo del mes se aplica a los días que faltan", () => {
    const d = serie("2026-06-01", "2026-10-21", (f) => (f >= "2026-10-01" ? 1.2 : 1));
    const r = proyectarMes(d, "2026-10-21")!;
    expect(r.ritmo).toBeGreaterThan(1.1);
    expect(r.proyeccion).toBeGreaterThan(r.facturado + r.estimadoRestante - 1);
    // Los días que faltan (22..31/10) valen su día de semana × ritmo.
    const restantesBase = serie("2026-10-22", "2026-10-31").reduce((a, b) => a + b.total, 0);
    expect(r.estimadoRestante).toBeGreaterThan(restantesBase);
  });

  it("cuenta los días que faltan por día de semana, en orden", () => {
    const r = proyectarMes(serie("2026-08-01", "2026-10-21"), "2026-10-21")!;
    // 22/10/2026 es jueves; faltan jue, vie, sáb ×2 y dom..mié ×1.
    expect(r.restantesPorDia).toEqual([
      { dow: 4, cantidad: 2 }, { dow: 5, cantidad: 2 }, { dow: 6, cantidad: 2 },
      { dow: 0, cantidad: 1 }, { dow: 1, cantidad: 1 }, { dow: 2, cantidad: 1 }, { dow: 3, cantidad: 1 },
    ]);
  });

  it("regla de 3, mismo ritmo y cierre del año anterior", () => {
    const d = serie("2025-08-01", "2026-10-21", (f) => (f < "2026-01-01" ? 0.5 : 1));
    const r = proyectarMes(d, "2026-10-21")!;
    expect(r.reglaDeTres).toBeCloseTo((r.facturado / 21) * 31, 6);
    expect(r.cierreAnioAnterior).toBeCloseTo(sumaMes(d, "2025-10"), 6);
    expect(r.mismoRitmoAnioAnterior).not.toBeNull();
  });

  it("sin historia del año anterior ni para el backtest, esos datos quedan en null", () => {
    const r = proyectarMes(serie("2026-10-01", "2026-10-21"), "2026-10-21")!;
    expect(r.cierreAnioAnterior).toBeNull();
    expect(r.mismoRitmoAnioAnterior).toBeNull();
    expect(r.backtest).toBeNull();
    expect(r.rango).toBeNull();
  });

  it("mes completo o sin ventas → no proyecta", () => {
    expect(proyectarMes(serie("2026-09-01", "2026-09-30"), "2026-09-30")).toBeNull();
    expect(proyectarMes([], "2026-10-21")).toBeNull();
  });

  it("el rango nunca baja de lo ya facturado", () => {
    const d = serie("2026-01-01", "2026-10-21", (f) => (f.slice(5, 7) === "07" ? 2 : 1));
    const r = proyectarMes(d, "2026-10-21")!;
    expect(r.rango!.min).toBeGreaterThanOrEqual(r.facturado);
  });
});

describe("debeProyectar", () => {
  it("solo el mes en curso incompleto (o el anterior durante la primera semana)", () => {
    expect(debeProyectar("2026-10-21", "2026-10-24")).toBe(true);
    expect(debeProyectar("2026-10-31", "2026-11-02")).toBe(false); // mes completo
    expect(debeProyectar("2026-10-29", "2026-11-03")).toBe(true); // falta importar
    expect(debeProyectar("2026-09-29", "2026-10-24")).toBe(false); // PDV que dejó de vender
    expect(debeProyectar(null, "2026-10-24")).toBe(false);
  });
});

describe("fmtMillones", () => {
  it("formatea compacto", () => {
    expect(fmtMillones(95_287_577)).toBe("$ 95,3 M");
    expect(fmtMillones(450_000)).toBe("$ 450 mil");
  });
});
