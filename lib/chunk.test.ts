import { describe, it, expect } from "vitest";
import { chunk } from "./chunk";

describe("chunk", () => {
  it("array vacío -> sin tandas", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("menos elementos que el tamaño de tanda -> una sola tanda con todos", () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it("exactamente el tamaño de tanda -> una sola tanda completa", () => {
    expect(chunk([1, 2, 3, 4, 5], 5)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it("más de una tanda con resto no exacto -> la última tanda queda incompleta", () => {
    const items = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(chunk(items, 5)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12],
    ]);
  });

  it("preserva el orden original dentro y entre tandas", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(chunk(items, 2)).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
  });

  it("size <= 0 -> tira RangeError", () => {
    expect(() => chunk([1, 2, 3], 0)).toThrow(RangeError);
    expect(() => chunk([1, 2, 3], -1)).toThrow(RangeError);
  });
});
