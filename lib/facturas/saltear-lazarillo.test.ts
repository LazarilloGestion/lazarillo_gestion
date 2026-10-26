import { describe, it, expect, vi } from "vitest";
import { normalizeCompras } from "@/lib/etl/normalizers/compras";
import { createMockDb } from "@/lib/etl/test-utils/mock-db";
import type { ETLRow } from "@/lib/etl/types";

const fila = (detalle: string, codigo = "92"): ETLRow => ({
  COD_CGA: "1", FECHA: 46287, CODIGO: codigo, CONCEPTO: "Almacen", DETALLE: detalle, PROVEEDOR: "El Criollo",
  OBSERVAC: "", IMPORTE: 1000, IMP_INT: 0, IMPUTAC: "", PER1: 0, PER2: 0, PER3: 0,
});

describe("import del 14 con facturas cargadas en Lazarillo", () => {
  it("saltea el comprobante que ya cargó Lazarillo (mismo local, número y proveedor) y carga el resto", async () => {
    const db = createMockDb();
    const findMany = db.compra.findMany as ReturnType<typeof vi.fn>;
    findMany.mockImplementation(async (args: { where?: { origen?: string } }) =>
      args?.where?.origen === "lazarillo" ? [{ comprobante: "A000800045204", codigo: "92" }] : []);
    const res = await normalizeCompras([fila("A  0008-00045204"), fila("A  0008-00045205"), fila("A  0008-00045204", "93")], db, { localId: 1, puntoDeVentaId: 1 });
    expect(res.skippedRows.map((s) => s.motivo)).toEqual(["cargada_en_lazarillo"]);
    expect(res.created).toBe(2);
  });
});
