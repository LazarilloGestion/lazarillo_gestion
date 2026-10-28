import { describe, it, expect } from "vitest";
import { esCelular } from "./es-celular";

describe("esCelular", () => {
  it("teléfonos sí, tablets y compu no", () => {
    expect(esCelular("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(esCelular("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36")).toBe(true);
    expect(esCelular("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36")).toBe(false);
    expect(esCelular("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(esCelular("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe(false);
    expect(esCelular(null)).toBe(false);
  });
});
