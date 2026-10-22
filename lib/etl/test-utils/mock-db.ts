import { vi } from "vitest";
import type { DbClient } from "../types";

type ModelMock = { findMany: ReturnType<typeof vi.fn>; update?: ReturnType<typeof vi.fn> };

/**
 * DbClient falso para tests unitarios de normalizers — sin base de datos real.
 * findMany por defecto devuelve [] (nada existe todavía); update por defecto
 * resuelve OK. Un override parcial (solo findMany, por ejemplo) se mergea
 * sobre estos defaults, no los reemplaza entero — así ningún test existente
 * que no conoce `.update()` se rompe al agregarlo acá.
 * $executeRaw por defecto resuelve OK; usar mockRejectedValueOnce para testear
 * el path de `errors` ante fallos de constraint.
 */
export function createMockDb(overrides: Partial<Record<string, ModelMock>> = {}) {
  const defaultModel = (): Required<ModelMock> => ({
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  });
  const db = {
    proveedor: { ...defaultModel(), ...overrides.proveedor },
    conceptoCaja: { ...defaultModel(), ...overrides.conceptoCaja },
    articulo: { ...defaultModel(), ...overrides.articulo },
    compra: { ...defaultModel(), ...overrides.compra },
    detalleCompra: { ...defaultModel(), ...overrides.detalleCompra },
    pago: { ...defaultModel(), ...overrides.pago },
    empleado: { ...defaultModel(), ...overrides.empleado },
    venta: { ...defaultModel(), ...overrides.venta },
    rubroArticulo: { ...defaultModel(), ...overrides.rubroArticulo },
    rubroConceptoCaja: { ...defaultModel(), ...overrides.rubroConceptoCaja },
    subrubroArticulo: { ...defaultModel(), ...overrides.subrubroArticulo },
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
