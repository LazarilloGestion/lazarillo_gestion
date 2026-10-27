import { describe, it, expect, vi } from "vitest";
import { normalizeCompras } from "@/lib/etl/normalizers/compras";
import { createMockDb } from "@/lib/etl/test-utils/mock-db";
import type { ETLRow } from "@/lib/etl/types";
import { excelDateToISO } from "@/lib/etl/helpers";
import { claveSalteo } from "./saltear-lazarillo";

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
  it("NC: la electrónica de MaxiRest (NcA) es la misma que la NC cargada en Lazarillo", async () => {
    const db = createMockDb();
    (db.compra.findMany as ReturnType<typeof vi.fn>).mockImplementation(async (args: { where?: { origen?: string } }) =>
      args?.where?.origen === "lazarillo" ? [{ comprobante: "NC000400004607", codigo: "92" }] : []);
    const res = await normalizeCompras([fila("NcA 0004-00004607")], db, { localId: 1, puntoDeVentaId: 1 });
    expect(res.skippedRows.map((s) => s.motivo)).toEqual(["cargada_en_lazarillo"]);
  });
  it("tickets: con el mismo número pero otra fecha es otra compra y se importa", async () => {
    const fecha = excelDateToISO(46287)!;
    const db = createMockDb();
    (db.compra.findMany as ReturnType<typeof vi.fn>).mockImplementation(async (args: { where?: { origen?: string } }) =>
      args?.where?.origen === "lazarillo" ? [{ comprobante: "Z152219062026", codigo: "92", fecha: new Date("2020-01-01T00:00:00Z") }] : []);
    const res = await normalizeCompras([fila("Tic 1522-19062026")], db, { localId: 1, puntoDeVentaId: 1 });
    expect(res.skippedRows).toEqual([]);
    expect(claveSalteo("Z152219062026", "92", fecha)).toBe(`Z152219062026|92|${fecha}`);
  });
});
