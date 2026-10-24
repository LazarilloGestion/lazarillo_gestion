import { describe, it, expect } from "vitest";
import { autocompletarDestino, opcionesDisponibles } from "./autocompletar-destino";

// Ramos (1) con Bar (1) y Canchas (2); San Justo (2) con Canchas (3).
const locales = [
  { id: 1, puntosDeVenta: [{ id: 1 }, { id: 2 }] },
  { id: 2, puntosDeVenta: [{ id: 3 }] },
];
const vacio = { localId: null, puntoDeVentaId: null, porcentaje: 10 };

describe("autocompletarDestino", () => {
  it("Ramos con Bar ya usado: queda solo Canchas y se elige sola", () => {
    const r = autocompletarDestino({ localId: 1, puntoDeVentaId: null, porcentaje: 20 }, locales, [{ localId: 1, puntoDeVentaId: 1 }]);
    expect(r).toEqual({ localId: 1, puntoDeVentaId: 2, porcentaje: 20 });
  });

  it("fila nueva cuando solo queda San Justo: elige local y su único PDV", () => {
    const otros = [{ localId: 1, puntoDeVentaId: 1 }, { localId: 1, puntoDeVentaId: 2 }];
    expect(autocompletarDestino(vacio, locales, otros)).toEqual({ localId: 2, puntoDeVentaId: 3, porcentaje: 10 });
  });

  it("con varias opciones libres no toca nada", () => {
    expect(autocompletarDestino(vacio, locales, [])).toEqual(vacio);
    const r = autocompletarDestino({ localId: 1, puntoDeVentaId: null, porcentaje: 50 }, locales, []);
    expect(r.puntoDeVentaId).toBeNull();
  });

  it("un local de un solo PDV ofrece el PDV, no 'Todo el local'", () => {
    expect(opcionesDisponibles(locales[1], [])).toEqual([3]);
    expect(opcionesDisponibles(locales[0], [{ localId: 1, puntoDeVentaId: null }])).toEqual([]);
  });
});
