import { describe, expect, it } from "vitest";
import { pick } from "./pick";

describe("pick", () => {
  it("selecciona solo las keys pedidas", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("con lista vacía devuelve objeto vacío", () => {
    expect(pick({ a: 1 }, [])).toEqual({});
  });
});
