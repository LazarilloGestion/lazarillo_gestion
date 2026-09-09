import { describe, it, expect } from "vitest";
import { describirOrigen } from "./descripcion-origen";
import type { Local } from "@/lib/types/domain";

const LOCALES: Local[] = [
  {
    id: 1,
    nombre: "Ramos Mejía",
    puntosDeVenta: [
      { id: 10, nombre: "Caja 1" },
      { id: 11, nombre: "Caja 2" },
    ],
  },
  { id: 2, nombre: "San Justo", puntosDeVenta: [] },
];

describe("describirOrigen", () => {
  it("PDV puntual: devuelve el nombre del punto de venta", () => {
    expect(describirOrigen(LOCALES, 1, 10)).toBe("Caja 1");
  });

  it("sin PDV: devuelve el local entero", () => {
    expect(describirOrigen(LOCALES, 2, null)).toBe("San Justo (todo el local)");
  });

  it("local desconocido, sin PDV: usa fallback", () => {
    expect(describirOrigen(LOCALES, 99, null)).toBe("Local (todo el local)");
  });

  it("PDV inexistente en el local: usa fallback de PDV", () => {
    expect(describirOrigen(LOCALES, 1, 999)).toBe("Punto de venta");
  });

  it("lista de locales vacía: fallbacks en ambos casos", () => {
    expect(describirOrigen([], 1, null)).toBe("Local (todo el local)");
    expect(describirOrigen([], 1, 10)).toBe("Punto de venta");
  });
});
