import { describe, it, expect } from "vitest";
import { esperadoEnMesCerrado, estaAtrasado, mesesObjetivo, resumenCompra, totales, venceEl, type ItemSinCarga } from "./estado";

describe("sin carga", () => {
  it("vence el día habitual del mes, o del siguiente si va a mes vencido", () => {
    expect(venceEl("2026-10", 11, false)).toBe("2026-10-11");
    expect(venceEl("2026-10", 2, true)).toBe("2026-11-02");
    expect(venceEl("2026-12", 5, true)).toBe("2027-01-05");
    expect(venceEl("2026-02", 30, false)).toBe("2026-02-28");
  });
  it("atrasado cuando ya pasó", () => {
    expect(estaAtrasado("2026-10-11", "2026-10-28")).toBe(true);
    expect(estaAtrasado("2026-10-30", "2026-10-28")).toBe(false);
    expect(estaAtrasado("2026-11-02", "2026-10-28")).toBe(false);
  });
  it("meses a mirar cruzan el año", () => {
    expect(mesesObjetivo("2026-01-10")).toEqual(["2026-01-01", "2025-12-01", "2025-11-01"]);
  });
  it("los chicos se ocultan salvo que se pidan", () => {
    const it = (ultimo: number) => ({ ultimo } as ItemSinCarga);
    expect(totales([it(29), it(12_400_000)], false)).toMatchObject({ n: 1, total: 12_400_000 });
    expect(totales([it(29), it(12_400_000)], true)).toMatchObject({ n: 2, total: 12_400_029 });
  });
  it("mantenimiento en un mes que ya pasó solo si es de todos los meses del año", () => {
    expect(esperadoEnMesCerrado("Mantenimiento", "2026-10", "2026-10", 3, 12)).toBe(true);   // mes en curso: sí
    expect(esperadoEnMesCerrado("Mantenimiento", "2026-09", "2026-10", 3, 12)).toBe(false);  // ya pasó, 3 de 12
    expect(esperadoEnMesCerrado("Mantenimiento", "2026-09", "2026-10", 12, 12)).toBe(true);  // todos los meses
    expect(esperadoEnMesCerrado("Mantenimiento", "2026-09", "2026-10", 7, 7)).toBe(true);    // PDV con 7 meses de datos
    expect(esperadoEnMesCerrado("Servicios", "2026-09", "2026-10", 3, 12)).toBe(true);       // otros rubros: igual que antes
  });
  it("qué le compro: el insumo más comprado y su concepto; si no, el concepto de mayor importe", () => {
    expect(resumenCompra([{ txt: "Harina 000", obs: "Almacen", imp: 10 }, { txt: "Oregano", obs: "Especias", imp: 50 }], [])).toBe("Oregano · Especias");
    expect(resumenCompra([], [{ txt: "Flete", obs: null, imp: 5 }, { txt: "Papelera", obs: "Bolsas 15x50", imp: 9 }])).toBe("Papelera");
    expect(resumenCompra([], [])).toBeNull();
  });
});
