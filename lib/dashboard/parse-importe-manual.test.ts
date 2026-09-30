import { describe, it, expect } from "vitest";
import { parseImporteManual } from "./parse-importe-manual";

describe("parseImporteManual", () => {
  it("string vacío: ok, value null (borra el override)", () => {
    expect(parseImporteManual("")).toEqual({ ok: true, value: null });
  });

  it("número entero: ok, value numérico", () => {
    expect(parseImporteManual("1000")).toEqual({ ok: true, value: 1000 });
  });

  it("número decimal: ok, value numérico", () => {
    expect(parseImporteManual("1000.50")).toEqual({ ok: true, value: 1000.5 });
  });

  it("número negativo: ok, value numérico (caso válido real)", () => {
    expect(parseImporteManual("-500")).toEqual({ ok: true, value: -500 });
  });

  it("input transitorio inválido ('-' solo, mientras el usuario escribe un negativo): ok false, no silenciosamente null", () => {
    expect(parseImporteManual("-")).toEqual({ ok: false });
  });

  it("texto no numérico: ok false", () => {
    expect(parseImporteManual("abc")).toEqual({ ok: false });
  });

  it("texto con número al principio pero basura después: ok false (Number no hace parseo parcial como parseFloat)", () => {
    expect(parseImporteManual("12abc")).toEqual({ ok: false });
  });

  it("dos puntos decimales: ok false", () => {
    expect(parseImporteManual("1.2.3")).toEqual({ ok: false });
  });

  it("solo espacios en blanco: ok, value null (se trata igual que vacío)", () => {
    expect(parseImporteManual("   ")).toEqual({ ok: true, value: null });
  });
});
