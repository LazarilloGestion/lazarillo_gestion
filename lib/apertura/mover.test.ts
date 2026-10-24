import { describe, it, expect } from "vitest";
import { objetivosMover, destinosMover, cuerpoMover, filasAMover } from "./mover";

const fila = (rowId: string, pdv = 1) => ({ rowId, localIdOrigen: 1, puntoDeVentaIdOrigen: pdv });
const locales = [
  { id: 1, nombre: "Ramos Mejía", puntosDeVenta: [{ id: 1, nombre: "Bar" }, { id: 2, nombre: "Canchas" }] },
  { id: 2, nombre: "San Justo", puntosDeVenta: [{ id: 3, nombre: "Canchas" }] },
];

describe("mover a otro PDV", () => {
  it("el ícono de una fila tildada mueve todas las tildadas (sin repetir distribuidas)", () => {
    const visibles = [fila("a"), fila("a"), fila("b"), fila("c")];
    expect(objetivosMover(visibles[0], new Set(["a", "b"]), visibles).map((r) => r.rowId)).toEqual(["a", "b"]);
    expect(objetivosMover(visibles[3], new Set(["a", "b"]), visibles).map((r) => r.rowId)).toEqual(["c"]);
  });

  it("deshabilita el PDV donde ya están todas", () => {
    const d = destinosMover(locales, [fila("a"), fila("b")]);
    expect(d.map((x) => [x.etiqueta, x.deshabilitado])).toEqual([
      ["Ramos Mejía · Bar", true],
      ["Ramos Mejía · Canchas", false],
      ["San Justo · Canchas", false],
    ]);
    expect(destinosMover(locales, [fila("a"), fila("b", 2)]).every((x) => !x.deshabilitado)).toBe(true);
  });

  it("arma una regla de registro histórica al 100% y saltea las que ya están ahí", () => {
    expect(cuerpoMover(fila("a"), { localId: 2, puntoDeVentaId: 3 })).toMatchObject({
      nivel: "registro", entidadId: "a", origenPuntoDeVentaId: 1, modo: "historico", confirmarHistorico: true,
      destinos: [{ localId: 2, puntoDeVentaId: 3, porcentaje: 100 }],
    });
    expect(filasAMover([fila("a"), fila("b", 2)], { puntoDeVentaId: 2 }).map((r) => r.rowId)).toEqual(["a"]);
  });
});
