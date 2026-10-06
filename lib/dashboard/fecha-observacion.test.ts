import { describe, it, expect } from "vitest";
import { anioDeFecha, formatFechaConAnio } from "./fecha-observacion";

describe("anioDeFecha", () => {
  it("extrae el año de una fecha YYYY-MM-DD", () => {
    expect(anioDeFecha("2025-03-14")).toBe(2025);
  });

  it("null cuando no hay fecha", () => {
    expect(anioDeFecha(null)).toBeNull();
  });

  it("null (no NaN) ante un formato inesperado, para no mandar un año inválido al store", () => {
    expect(anioDeFecha("14/03/2025")).toBeNull();
    expect(anioDeFecha("")).toBeNull();
  });
});

describe("formatFechaConAnio", () => {
  it("formatea como dd/mm/aaaa incluyendo el año", () => {
    expect(formatFechaConAnio("2025-03-14")).toBe("14/03/2025");
  });

  it("null cuando no hay fecha", () => {
    expect(formatFechaConAnio(null)).toBeNull();
  });

  it("null ante un formato inesperado", () => {
    expect(formatFechaConAnio("14/03/2025")).toBeNull();
  });
});
