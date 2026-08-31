import { describe, it, expect } from "vitest";
import { resumirFilasCero, type FilaCero } from "./limpiar-flujo-caja-cero";

describe("resumirFilasCero", () => {
  it("sin filas: informa que no hay nada que borrar", () => {
    expect(resumirFilasCero([])).toContain("0 filas");
  });

  it("lista cada fila con local, pdv, año y mes", () => {
    const filas: FilaCero[] = [
      { localId: 2, puntoDeVentaId: null, anio: 2025, mes: 6 },
      { localId: 2, puntoDeVentaId: null, anio: 2025, mes: 7 },
      { localId: 3, puntoDeVentaId: 10, anio: 2025, mes: 8 },
    ];
    const salida = resumirFilasCero(filas);
    expect(salida).toContain("3 filas");
    expect(salida).toContain("local 2");
    expect(salida).toContain("2025-06");
    expect(salida).toContain("pdv 10");
  });
});
