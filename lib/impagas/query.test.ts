import { describe, it, expect } from "vitest";
import { IMPAGAS_DESDE_DEFAULT, impagasDesde } from "./query";

describe("filtro Desde de impagas", () => {
  it("usa el parámetro si es una fecha razonable", () => {
    expect(impagasDesde("2026-03-01", undefined)).toBe("2026-03-01");
  });
  it("ignora años a medio escribir (0002, 0202…) y cae a la variable o al default", () => {
    expect(impagasDesde("0202-09-01", undefined)).toBe(IMPAGAS_DESDE_DEFAULT);
    expect(impagasDesde("0002-09-01", "2025-01-01")).toBe("2025-01-01");
  });
});
