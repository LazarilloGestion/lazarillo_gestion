import { describe, it, expect } from "vitest";
import { totalLinea, totalComprobante, sortCompraLineas, whereLineasDeCompra } from "./compra-lineas";
import type { DetalleCompraLinea } from "./types";

function linea(overrides: Partial<DetalleCompraLinea>): DetalleCompraLinea {
  return {
    rowId: "r",
    codigo: null,
    nombre: null,
    cantidad: null,
    medida: null,
    neto: null,
    totalIns: null,
    ivaTot: null,
    impNtTot: null,
    observac: null,
    ...overrides,
  };
}

describe("totalLinea", () => {
  it("suma totalIns + IVA (caso reportado: energía eléctrica, A 0014-23457820)", () => {
    expect(totalLinea(linea({ totalIns: "3281120.18", ivaTot: "885902.45", impNtTot: "0" }))).toBeCloseTo(4167022.63, 2);
    expect(totalLinea(linea({ totalIns: "14361.53", ivaTot: "3877.61", impNtTot: "0" }))).toBeCloseTo(18239.14, 2);
  });

  it("incluye impuestos internos", () => {
    expect(totalLinea(linea({ totalIns: 1000, ivaTot: 210, impNtTot: 50 }))).toBe(1260);
  });

  it("un componente null cuenta como 0", () => {
    expect(totalLinea(linea({ totalIns: "1000", ivaTot: null, impNtTot: null }))).toBe(1000);
    expect(totalLinea(linea({ totalIns: null, ivaTot: "210", impNtTot: null }))).toBe(210);
  });

  it("sin ningún componente devuelve null (no inventa un $0)", () => {
    expect(totalLinea(linea({}))).toBeNull();
  });
});

describe("totalComprobante", () => {
  it("suma el total de todas las líneas (factura completa)", () => {
    const lineas = [
      linea({ totalIns: "3281120.18", ivaTot: "885902.45", impNtTot: "0" }),
      linea({ totalIns: "14361.53", ivaTot: "3877.61", impNtTot: "0" }),
      linea({ totalIns: "32811.20", ivaTot: "0", impNtTot: "0" }),
    ];
    expect(totalComprobante(lineas)).toBeCloseTo(4218072.97, 2);
  });

  it("ignora líneas sin componentes en vez de romper la suma", () => {
    expect(totalComprobante([linea({ totalIns: 100 }), linea({})])).toBe(100);
  });

  it("sin líneas con importe devuelve null", () => {
    expect(totalComprobante([])).toBeNull();
    expect(totalComprobante([linea({})])).toBeNull();
  });
});

describe("sortCompraLineas", () => {
  const sortBy = (lineas: DetalleCompraLinea[], key: string, dir: "asc" | "desc") =>
    [...lineas].sort((a, b) => sortCompraLineas(a, b, { key, dir })).map((l) => l.rowId);

  it("sin orden mantiene el orden original", () => {
    expect(sortCompraLineas(linea({ codigo: "201" }), linea({ codigo: "59" }), null)).toBe(0);
  });

  it("código ordena numérico, no alfabético (59 antes que 201)", () => {
    const lineas = [linea({ rowId: "a", codigo: "201" }), linea({ rowId: "b", codigo: "59" }), linea({ rowId: "c", codigo: "999" })];
    expect(sortBy(lineas, "codigo", "asc")).toEqual(["b", "a", "c"]);
    expect(sortBy(lineas, "codigo", "desc")).toEqual(["c", "a", "b"]);
  });

  it("nombre ordena alfabético en español", () => {
    const lineas = [linea({ rowId: "a", nombre: "Servicio" }), linea({ rowId: "b", nombre: "Contribucion" })];
    expect(sortBy(lineas, "nombre", "asc")).toEqual(["b", "a"]);
  });

  it("total ordena por el total con impuestos, no por totalIns", () => {
    const lineas = [
      linea({ rowId: "a", totalIns: 100, ivaTot: 0 }),
      linea({ rowId: "b", totalIns: 90, ivaTot: 20 }),
    ];
    expect(sortBy(lineas, "total", "desc")).toEqual(["b", "a"]);
  });

  it.each(["cantidad", "neto", "ivaTot", "impNtTot"])("%s ordena numérico (string decimal de Prisma)", (key) => {
    const lineas = [linea({ rowId: "a", [key]: "1000.5" }), linea({ rowId: "b", [key]: "99" })];
    expect(sortBy(lineas, key, "asc")).toEqual(["b", "a"]);
  });

  it("valores null van al final en ambos sentidos", () => {
    const lineas = [linea({ rowId: "a", neto: null }), linea({ rowId: "b", neto: 5 }), linea({ rowId: "c", neto: 10 })];
    expect(sortBy(lineas, "neto", "asc")).toEqual(["b", "c", "a"]);
    expect(sortBy(lineas, "neto", "desc")).toEqual(["c", "b", "a"]);
    const textos = [linea({ rowId: "a", observac: null }), linea({ rowId: "b", observac: "x" })];
    expect(sortBy(textos, "observac", "asc")).toEqual(["b", "a"]);
    expect(sortBy(textos, "observac", "desc")).toEqual(["b", "a"]);
  });
});

describe("whereLineasDeCompra", () => {
  it("filtra por comprobante, local y proveedor (mismo número de ticket entre proveedores)", () => {
    expect(whereLineasDeCompra({ comprobante: "Z000100000001", localId: 1, codigo: "194" }, "c1")).toEqual({
      comprobante: "Z000100000001",
      localId: 1,
      codPro: "194",
    });
  });

  it("sin proveedor en la compra no filtra por proveedor (no esconde líneas)", () => {
    expect(whereLineasDeCompra({ comprobante: "Z000100000001", localId: 1, codigo: null }, "c1")).toEqual({
      comprobante: "Z000100000001",
      localId: 1,
    });
  });

  it("sin comprobante cae al vínculo directo por compraId", () => {
    expect(whereLineasDeCompra({ comprobante: null, localId: 1, codigo: "194" }, "c1")).toEqual({ compraId: "c1" });
  });

  it("compra inexistente cae al vínculo directo por compraId", () => {
    expect(whereLineasDeCompra(null, "c1")).toEqual({ compraId: "c1" });
  });
});
