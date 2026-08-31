import { describe, it, expect } from "vitest";
import { aggregateFlujoCajaPorMes, type FlujoCajaRow } from "./flujo-caja-agg";

describe("aggregateFlujoCajaPorMes", () => {
  it("sin filas devuelve los 12 meses en null", () => {
    const result = aggregateFlujoCajaPorMes([]);
    expect(Object.keys(result)).toHaveLength(12);
    expect(result[1]).toBeNull();
    expect(result[12]).toBeNull();
  });

  it("PDV puntual: suma directo sin considerar el nivel local", () => {
    const rows: FlujoCajaRow[] = [
      { localId: 1, puntoDeVentaId: 10, mes: 3, monto: 100 },
      { localId: 1, puntoDeVentaId: 10, mes: 3, monto: 50 },
    ];
    const result = aggregateFlujoCajaPorMes(rows, 10);
    expect(result[3]).toBe(150);
  });

  it("sin PDV puntual: un local con carga solo a nivel PDV se suma", () => {
    const rows: FlujoCajaRow[] = [
      { localId: 1, puntoDeVentaId: 10, mes: 5, monto: 100 },
      { localId: 1, puntoDeVentaId: 11, mes: 5, monto: 200 },
    ];
    const result = aggregateFlujoCajaPorMes(rows);
    expect(result[5]).toBe(300);
  });

  it("sin PDV puntual: carga a ambos niveles para el mismo mes, gana el nivel local (no se duplica)", () => {
    const rows: FlujoCajaRow[] = [
      { localId: 1, puntoDeVentaId: null, mes: 5, monto: 500 },
      { localId: 1, puntoDeVentaId: 10, mes: 5, monto: 100 },
      { localId: 1, puntoDeVentaId: 11, mes: 5, monto: 200 },
    ];
    const result = aggregateFlujoCajaPorMes(rows);
    expect(result[5]).toBe(500);
  });

  it("múltiples locales se agregan independientemente y se suman entre sí", () => {
    const rows: FlujoCajaRow[] = [
      { localId: 1, puntoDeVentaId: null, mes: 6, monto: 500 },
      { localId: 2, puntoDeVentaId: 20, mes: 6, monto: 300 },
    ];
    const result = aggregateFlujoCajaPorMes(rows);
    expect(result[6]).toBe(800);
  });

  it("nivel local con monto 0 se ignora; si hay PDV con valor, se usa (monto 0 es sin dato)", () => {
    const rows: FlujoCajaRow[] = [
      { localId: 1, puntoDeVentaId: null, mes: 5, monto: 0 },
      { localId: 1, puntoDeVentaId: 10, mes: 5, monto: 200 },
    ];
    const result = aggregateFlujoCajaPorMes(rows);
    expect(result[5]).toBe(200);
  });

  it("una fila con monto 0 no cuenta como dato: el mes queda en null", () => {
    const meses = aggregateFlujoCajaPorMes(
      [{ localId: 2, puntoDeVentaId: null, mes: 6, monto: 0 }],
    );
    expect(meses[6]).toBeNull();
  });

  it("mismo mes con una fila en 0 y otra con valor real: agrega solo la real", () => {
    const meses = aggregateFlujoCajaPorMes(
      [
        { localId: 2, puntoDeVentaId: 10, mes: 9, monto: 0 },
        { localId: 2, puntoDeVentaId: 11, mes: 9, monto: 1000 },
      ],
    );
    expect(meses[9]).toBe(1000);
  });

  it("con puntoDeVentaId puntual, una fila en 0 tampoco cuenta", () => {
    const meses = aggregateFlujoCajaPorMes(
      [{ localId: 2, puntoDeVentaId: 10, mes: 9, monto: 0 }],
      10,
    );
    expect(meses[9]).toBeNull();
  });
});
