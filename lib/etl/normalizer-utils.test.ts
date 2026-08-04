import { describe, it, expect, vi } from "vitest";
import { preloadExistingCodes, linkDetalleComprasByComprobante, processBatch } from "./normalizer-utils";
import { createMockDb } from "./test-utils/mock-db";

describe("preloadExistingCodes", () => {
  it("array vacío -> Set vacío, no llama al fetcher", async () => {
    const fetcher = vi.fn();
    const result = await preloadExistingCodes([], fetcher);
    expect(result).toEqual(new Set());
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("pasa los códigos tal cual al fetcher (sin dedupear el input)", async () => {
    const fetcher = vi.fn().mockResolvedValue([{ codigo: "A" }, { codigo: "B" }]);
    await preloadExistingCodes(["A", "A", "B"], fetcher);
    expect(fetcher).toHaveBeenCalledWith(["A", "A", "B"]);
  });

  it("dedupea el output vía Set aunque el fetcher devuelva códigos repetidos", async () => {
    const fetcher = vi.fn().mockResolvedValue([{ codigo: "A" }, { codigo: "A" }]);
    const result = await preloadExistingCodes(["A", "A"], fetcher);
    expect(result.size).toBe(1);
    expect(result.has("A")).toBe(true);
  });
});

describe("linkDetalleComprasByComprobante", () => {
  it("llama $executeRaw una vez con localId interpolado (aparece 2 veces en el SQL)", async () => {
    const db = createMockDb();
    await linkDetalleComprasByComprobante(db, 42);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    const callArgs = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0];
    const interpolatedValues = callArgs.slice(1);
    expect(interpolatedValues).toEqual([42, 42]);
  });

  it("no traga el error si $executeRaw rechaza — no hay try/catch, se propaga", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    await expect(linkDetalleComprasByComprobante(db, 1)).rejects.toThrow("constraint violation");
  });
});

describe("processBatch", () => {
  it("todos los items exitosos en un solo batch (< 50) -> sin errores, fn llamada una vez por item", async () => {
    const items = [1, 2, 3];
    const fn = vi.fn().mockResolvedValue(undefined);
    const errors = await processBatch(items, fn, (item) => item);
    expect(errors).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenNthCalledWith(1, 1, 0);
    expect(fn).toHaveBeenNthCalledWith(2, 2, 1);
    expect(fn).toHaveBeenNthCalledWith(3, 3, 2);
  });

  it("array vacío -> [] sin errores, fn nunca se llama", async () => {
    const fn = vi.fn();
    const errors = await processBatch([], fn, (item) => item);
    expect(errors).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("cruza el límite de BATCH_SIZE=50: el índice global no se resetea entre batches", async () => {
    const items = Array.from({ length: 51 }, (_, i) => i);
    const fn = vi.fn().mockResolvedValue(undefined);
    await processBatch(items, fn, (item) => item);
    expect(fn).toHaveBeenCalledTimes(51);
    // Ítem 50 (índice 0 del segundo batch) debe recibir index=50, no index=0.
    expect(fn).toHaveBeenNthCalledWith(51, 50, 50);
  });

  it("un fallo en el batch 1 no bloquea el batch 2 (aislamiento cruzando el límite de batch)", async () => {
    const items = Array.from({ length: 51 }, (_, i) => i);
    const fn = vi.fn().mockImplementation(async (item: number) => {
      if (item === 0) throw new Error("boom item 0");
      // el resto, incluido el item 50 (único del segundo batch), resuelve OK
    });
    const errors = await processBatch(items, fn, (item) => item);
    expect(errors).toHaveLength(1);
    expect(errors[0].rowIndex).toBe(0);
    // Confirma que el batch 2 (que contiene solo el item 50) se ejecutó igual.
    expect(fn).toHaveBeenCalledWith(50, 50);
  });

  it("extrae el mensaje de un Error normal", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const errors = await processBatch([1], fn, (item) => item);
    expect(errors[0].message).toBe("boom");
  });

  it("extrae el mensaje de un rechazo no-Error (string)", async () => {
    const fn = vi.fn().mockRejectedValue("string reason");
    const errors = await processBatch([1], fn, (item) => item);
    expect(errors[0].message).toBe("string reason");
  });

  it("getRawCodigo recibe el item original de la fila que falló", async () => {
    const items = [{ codigo: "A" }, { codigo: "B" }];
    const fn = vi.fn().mockImplementation(async (item: { codigo: string }) => {
      if (item.codigo === "B") throw new Error("falló B");
    });
    const getRawCodigo = vi.fn((item: { codigo: string }) => item.codigo);
    const errors = await processBatch(items, fn, getRawCodigo);
    expect(errors).toHaveLength(1);
    expect(errors[0].rawCodigo).toBe("B");
    expect(getRawCodigo).toHaveBeenCalledWith({ codigo: "B" });
  });
});
