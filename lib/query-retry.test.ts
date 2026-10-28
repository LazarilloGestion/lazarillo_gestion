import { describe, it, expect } from "vitest";
import { debeReintentar, HttpError } from "./query-retry";

describe("debeReintentar", () => {
  it("un solo reintento como máximo", () => {
    expect(debeReintentar(0, new Error("red"))).toBe(true);
    expect(debeReintentar(1, new Error("red"))).toBe(false);
  });
  it("no reintenta timeouts de la base ni errores del pedido", () => {
    expect(debeReintentar(0, new HttpError(500))).toBe(false);
    expect(debeReintentar(0, new HttpError(504))).toBe(false);
    expect(debeReintentar(0, new HttpError(401))).toBe(false);
    expect(debeReintentar(0, new HttpError(404))).toBe(false);
  });
  it("reintenta lo pasajero", () => {
    expect(debeReintentar(0, new HttpError(502))).toBe(true);
    expect(debeReintentar(0, new HttpError(503))).toBe(true);
  });
});
