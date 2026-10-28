import { describe, it, expect } from "vitest";
import { cambiosLote, describirCambios } from "./edicion-lote";

const base = { fecha: "2026-10-02", concepto: "48", observac: "3 profes GP" };

describe("cambiosLote", () => {
  it("sin cambios no manda nada", () => {
    expect(cambiosLote(base, base)).toEqual({});
  });
  it("solo manda los campos tocados", () => {
    expect(cambiosLote(base, { ...base, concepto: "51" })).toEqual({ conceptoCodigoManual: "51" });
    expect(cambiosLote(base, { ...base, fecha: "2026-10-05" })).toEqual({ fechaManual: "2026-10-05T12:00:00.000Z" });
  });
  it("vaciar un campo lo vuelve al original (null)", () => {
    expect(cambiosLote(base, { ...base, observac: "", fecha: "" })).toEqual({ observacManual: null, fechaManual: null });
  });
});

describe("describirCambios", () => {
  it("arma la frase", () => {
    expect(describirCambios({ conceptoCodigoManual: "1" })).toBe("concepto");
    expect(describirCambios({ fechaManual: null, conceptoCodigoManual: "1", observacManual: "x" })).toBe("fecha, concepto y observación");
    expect(describirCambios({})).toBe("");
  });
  it("importe en $0: es lo único del importe que va a todas las tildadas", () => {
    const ini = { fecha: "2026-10-01", concepto: "1", observac: "" };
    expect(cambiosLote(ini, ini, true)).toEqual({ importeManual: 0 });
    expect(cambiosLote(ini, ini, false)).toEqual({});
    expect(describirCambios({ importeManual: 0, observacManual: "x" })).toBe("observación y importe en $0");
  });
});
