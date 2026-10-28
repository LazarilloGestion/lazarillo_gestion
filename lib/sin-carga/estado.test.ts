import { describe, it, expect } from "vitest";
import { estaAtrasado, mesesObjetivo, totales, venceEl, type ItemSinCarga } from "./estado";

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
});
