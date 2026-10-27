import { describe, it, expect } from "vitest";
import { escalarA, totalFactura } from "./escalar";

const f = {
  registros: [
    { neto: 47151, alicuota: 10.5, impInt: 0 },
    { neto: 15692.72, alicuota: 21, impInt: 0 },
    { neto: 5913, alicuota: 21, impInt: 0 },
  ],
  percepciones: [{ tipo: "Perc. IVA RG 3337", importe: 9226.17 }],
  impIntGeneral: 0,
} as never;

describe("escalarA", () => {
  it("total como el servidor (IVA redondeado por renglón)", () => { expect(totalFactura(f)).toBeCloseTo(87470.95, 1); });
  it("lleva la estructura al total del QR (±1 centavo por el redondeo del IVA)", () => {
    for (const t of [100000, 87470.95, 12345.67, 999999.99]) expect(Math.abs(totalFactura(escalarA(f, t)) - t)).toBeLessThanOrEqual(0.011);
  });
});
