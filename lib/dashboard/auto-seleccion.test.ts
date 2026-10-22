import { describe, it, expect } from "vitest";
import { autoSeleccion } from "./auto-seleccion";

const comercio = [{ id: 1, puntosDeVenta: [{ id: 1 }] }];
const ramos = [
  { id: 1, puntosDeVenta: [{ id: 1 }, { id: 2 }] },
  { id: 2, puntosDeVenta: [{ id: 3 }] },
];

describe("autoSeleccion", () => {
  it("un solo local con un solo PDV: elige los dos", () => {
    expect(autoSeleccion(comercio, { localId: undefined, pdvId: undefined })).toEqual({ localId: 1, pdvId: 1 });
  });

  it("varios locales sin elegir: no toca nada", () => {
    expect(autoSeleccion(ramos, { localId: undefined, pdvId: undefined })).toBeNull();
  });

  it("local con un solo PDV (San Justo): elige el PDV", () => {
    expect(autoSeleccion(ramos, { localId: 2, pdvId: undefined })).toEqual({ localId: 2, pdvId: 3 });
  });

  it("local con varios PDV: deja 'todos'", () => {
    expect(autoSeleccion(ramos, { localId: 1, pdvId: undefined })).toBeNull();
  });

  it("ya elegido o sin locales cargados: null", () => {
    expect(autoSeleccion(comercio, { localId: 1, pdvId: 1 })).toBeNull();
    expect(autoSeleccion([], { localId: undefined, pdvId: undefined })).toBeNull();
  });
});
