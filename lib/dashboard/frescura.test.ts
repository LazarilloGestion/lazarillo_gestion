import { describe, it, expect } from "vitest";
import { frescura, diasAtras, hoyArgentina } from "./frescura";

describe("frescura", () => {
  it("hasta ayer al día, 2-3 días atrasado, más viejo rojo", () => {
    expect(frescura("2026-10-25", "2026-10-26")).toBe("al_dia");
    expect(frescura("2026-10-26", "2026-10-26")).toBe("al_dia");
    expect(frescura("2026-10-23", "2026-10-26")).toBe("atrasado");
    expect(frescura("2026-10-21", "2026-10-26")).toBe("viejo");
    expect(diasAtras("2026-09-29", "2026-10-26")).toBe(27);
  });
  it("hoy en Argentina (UTC-3)", () => {
    expect(hoyArgentina(new Date("2026-10-26T02:00:00Z"))).toBe("2026-10-25");
    expect(hoyArgentina(new Date("2026-10-26T04:00:00Z"))).toBe("2026-10-26");
  });
});
