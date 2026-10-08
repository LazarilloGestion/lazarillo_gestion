import { describe, it, expect } from "vitest";
import { recortarConHasMore } from "./recortar-has-more";

describe("recortarConHasMore", () => {
  it("menos filas que el límite: devuelve todas, sin hasMore", () => {
    expect(recortarConHasMore([1, 2], 3)).toEqual({ data: [1, 2], hasMore: false });
  });

  it("exactamente el límite: devuelve todas, sin hasMore", () => {
    expect(recortarConHasMore([1, 2, 3], 3)).toEqual({ data: [1, 2, 3], hasMore: false });
  });

  it("límite + 1 (la fila centinela): recorta al límite y marca hasMore", () => {
    expect(recortarConHasMore([1, 2, 3, 4], 3)).toEqual({ data: [1, 2, 3], hasMore: true });
  });

  it("sin filas: lista vacía, sin hasMore", () => {
    expect(recortarConHasMore([], 3)).toEqual({ data: [], hasMore: false });
  });
});
