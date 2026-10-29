import { describe, expect, it } from "vitest";
import { altaSchema, claveIngreso, diasEntre, esManual, itemsDeGrilla } from "./carga";

describe("ingresos manuales", () => {
  it("tipo y forma de cobro opcionales; importe 0 no", () => {
    expect(altaSchema.safeParse({ pdvId: 1, items: [{ fecha: "2026-01-16", importe: 1800000 }] }).success).toBe(true);
    const r = altaSchema.parse({ pdvId: 1, items: [{ fecha: "2026-01-16", importe: 5, tipo: "  ", cobro: "MERCADOPAGO" }] });
    expect(r.items[0]).toMatchObject({ tipo: null, cobro: "MERCADOPAGO", detalle: null });
    expect(altaSchema.safeParse({ pdvId: 1, items: [{ fecha: "2026-01-16", importe: 0 }] }).success).toBe(false);
    expect(altaSchema.safeParse({ pdvId: 1, items: [{ fecha: "16/01/2026", importe: 5 }] }).success).toBe(false);
  });
  it("grilla por tipo: una fila por celda con importe, de menor a mayor fecha", () => {
    const p = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
    const items = itemsDeGrilla("tipo", { "2026-01-17": { SALON: "1.700.000", SOCIO: "" }, "2026-01-16": { SALON: "1.120.000", MOSTR: "200.000,50" } }, p, "PDV caído");
    expect(items.map((i) => [i.fecha, i.tipo, i.cobro, i.importe])).toEqual([
      ["2026-01-16", "SALON", null, 1120000], ["2026-01-16", "MOSTR", null, 200000.5], ["2026-01-17", "SALON", null, 1700000],
    ]);
    expect(itemsDeGrilla("total", { "2026-01-16": { total: "10" } }, Number, null)[0]).toMatchObject({ tipo: null, cobro: null });
  });
  it("misma clave = mismo ingreso (no se duplica)", () => {
    expect(claveIngreso({ fecha: "2026-01-16", tipo: "salon", cobro: null, importe: 1120000 }))
      .toBe(claveIngreso({ fecha: "2026-01-16", tipo: "SALON ", cobro: "", importe: 1120000.001 }));
  });
  it("días del rango y marca de manual", () => {
    expect(diasEntre("2026-01-30", "2026-02-02")).toEqual(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
    expect(diasEntre("2026-02-02", "2026-01-30")).toEqual([]);
    expect(esManual("man-abc")).toBe(true);
    expect(esManual("71154a4a6247f758975f246e")).toBe(false);
  });
});
