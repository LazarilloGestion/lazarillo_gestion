import { describe, expect, it } from "vitest";
import { correrFecha, ctxDesdeCelda, mesAnteriorConValor } from "./carga-desde-celda";

describe("carga de gasto vario desde una celda vacía", () => {
  it("toma el último mes anterior con importe", () => {
    expect(mesAnteriorConValor({ 7: 80000, 8: 88000 }, 10)).toEqual({ mes: 8, importe: 88000 });
    expect(mesAnteriorConValor({ 7: 80000, 8: 0.2 }, 9)).toEqual({ mes: 7, importe: 80000 });
    expect(mesAnteriorConValor({ 11: 5 }, 3)).toBeNull();
  });
  it("corre la fecha de pago al mismo día, con tope fin de mes y cambio de año", () => {
    expect(correrFecha("2026-08-10", 2)).toBe("2026-10-10");
    expect(correrFecha("2026-01-31", 1)).toBe("2026-02-28");
    expect(correrFecha("2026-11-05", 2)).toBe("2027-01-05");
    expect(correrFecha("2026-08-10T00:00:00.000Z", 1)).toBe("2026-09-10");
    expect(correrFecha(null, 1)).toBeNull();
  });
  it("arma el ctx: período, concepto, importe anterior marcado y fecha de pago", () => {
    const p = { anio: 2026, mes: 9, conceptoCodigo: "77", conceptoNombre: "Cochera Abono", prev: { mes: 8, importe: 88000 }, filtroPrev: null };
    expect(ctxDesdeCelda(p, "2026-08-05")).toEqual({ modo: "vario", conceptoCodigo: "77", periodo: "2026-09", importe: 88000, importeAnterior: "2026-08", fechaPago: "2026-09-05" });
    expect(ctxDesdeCelda({ ...p, prev: null }, null)).toMatchObject({ importe: 0, importeAnterior: null, fechaPago: null });
  });
});
