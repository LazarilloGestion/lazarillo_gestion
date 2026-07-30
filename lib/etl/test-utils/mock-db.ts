import { vi } from "vitest";
import type { DbClient } from "../types";

type ModelMock = { findMany: ReturnType<typeof vi.fn> };

/**
 * DbClient falso para tests unitarios de normalizers — sin base de datos real.
 * findMany por defecto devuelve [] (nada existe todavía).
 * $executeRaw por defecto resuelve OK; usar mockRejectedValueOnce para testear
 * el path de `errors` ante fallos de constraint.
 */
export function createMockDb(overrides: Partial<Record<string, ModelMock>> = {}) {
  const defaultModel = (): ModelMock => ({ findMany: vi.fn().mockResolvedValue([]) });
  const db = {
    proveedor: overrides.proveedor ?? defaultModel(),
    conceptoCaja: overrides.conceptoCaja ?? defaultModel(),
    articulo: overrides.articulo ?? defaultModel(),
    compra: overrides.compra ?? defaultModel(),
    detalleCompra: overrides.detalleCompra ?? defaultModel(),
    venta: overrides.venta ?? defaultModel(),
    rubroArticulo: overrides.rubroArticulo ?? defaultModel(),
    rubroConceptoCaja: overrides.rubroConceptoCaja ?? defaultModel(),
    subrubroArticulo: overrides.subrubroArticulo ?? defaultModel(),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  return db as unknown as DbClient;
}

/**
 * Simula "todo lo consultado ya existe" (findMany hace eco de los IDs pedidos)
 * para poder testear el conteo `updated` sin conocer los hashes rowId de antemano.
 */
export function mockAllExisting(model: ModelMock, idField: "rowId" | "codigo") {
  model.findMany.mockImplementation(
    async (args: { where?: Record<string, { in?: string[] }> }) => {
      const ids = args?.where?.[idField]?.in ?? [];
      return ids.map((id) => ({ [idField]: id }));
    }
  );
}
