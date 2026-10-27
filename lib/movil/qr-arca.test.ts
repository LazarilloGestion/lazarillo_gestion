import { describe, it, expect } from "vitest";
import { leerQrArca } from "./qr-arca";

const qr = (o: object) => `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(o)).toString("base64")}`;

describe("leerQrArca", () => {
  it("lee una factura A", () => {
    expect(leerQrArca(qr({ ver: 1, fecha: "2026-10-22", cuit: 30712345678, ptoVta: 8, tipoCmp: 1, nroCmp: 49951, importe: 622414.85, moneda: "PES", ctz: 1 })))
      .toEqual({ cuit: "30712345678", fecha: "2026-10-22", ptoVta: 8, numero: 49951, tipoCmp: 1, tipo: "FcA", importe: 622414.85, moneda: "PES" });
  });
  it("tique factura B y nota de crédito", () => {
    expect(leerQrArca(qr({ fecha: "2026-10-01", cuit: "20-11111111-2", ptoVta: 3, tipoCmp: 82, nroCmp: 5, importe: 1000 }))?.tipo).toBe("FcB");
    expect(leerQrArca(qr({ fecha: "2026-10-01", cuit: 20111111112, ptoVta: 3, tipoCmp: 3, nroCmp: 5, importe: 1000 }))?.tipo).toBe("NC-A");
  });
  it("dominio arca.gob.ar y base64 url-safe", () => {
    const b = Buffer.from(JSON.stringify({ fecha: "2026-10-01", cuit: 30712345678, ptoVta: 1, tipoCmp: 11, nroCmp: 7, importe: 50 })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(leerQrArca(`https://www.arca.gob.ar/fe/qr/?p=${b}`)?.tipo).toBe("FcC");
  });
  it("QR que no es de ARCA: null", () => {
    expect(leerQrArca("https://example.com")).toBeNull();
    expect(leerQrArca(qr({ hola: 1 }))).toBeNull();
  });
});
