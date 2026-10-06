import { describe, it, expect } from "vitest";
import { resolverImporteParaPatch } from "./importe-para-patch";

describe("resolverImporteParaPatch", () => {
  describe("compra sin apertura", () => {
    it("siempre incluye el importe, aunque no haya cambiado", () => {
      expect(
        resolverImporteParaPatch({ esDistribuida: false, importeInput: "1000", importeInicial: "1000" })
      ).toEqual({ ok: true, incluir: true, value: 1000 });
    });

    it("input vacío: incluye null (borra el override)", () => {
      expect(
        resolverImporteParaPatch({ esDistribuida: false, importeInput: "", importeInicial: "1000" })
      ).toEqual({ ok: true, incluir: true, value: null });
    });

    it("input inválido: rechaza en vez de mandar null", () => {
      expect(
        resolverImporteParaPatch({ esDistribuida: false, importeInput: "abc", importeInicial: "1000" })
      ).toEqual({ ok: false });
    });
  });

  describe("compra aperturada", () => {
    it("importe sin cambios: no lo incluye (no marca la compra como editada)", () => {
      expect(
        resolverImporteParaPatch({ esDistribuida: true, importeInput: "1000", importeInicial: "1000" })
      ).toEqual({ ok: true, incluir: false });
    });

    it("mismo valor escrito distinto ('1000.00' vs '1000'): se considera sin cambios", () => {
      expect(
        resolverImporteParaPatch({ esDistribuida: true, importeInput: "1000.00", importeInicial: "1000" })
      ).toEqual({ ok: true, incluir: false });
    });

    it("importe corregido: lo incluye para que el servidor reparta de nuevo", () => {
      expect(
        resolverImporteParaPatch({ esDistribuida: true, importeInput: "100", importeInicial: "1000000" })
      ).toEqual({ ok: true, incluir: true, value: 100 });
    });

    it("input vacío: incluye null (vuelve al importe original del ERP)", () => {
      expect(
        resolverImporteParaPatch({ esDistribuida: true, importeInput: "", importeInicial: "1000" })
      ).toEqual({ ok: true, incluir: true, value: null });
    });

    it("input inválido: rechaza, aunque la compra esté aperturada", () => {
      expect(
        resolverImporteParaPatch({ esDistribuida: true, importeInput: "12abc", importeInicial: "1000" })
      ).toEqual({ ok: false });
    });
  });
});
