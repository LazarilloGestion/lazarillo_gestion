import { describe, it, expect } from "vitest";
import { planReconciliacionDuplicados, type CompraParaReconciliar } from "./reconciliar-duplicados-erp";

const BASE = {
  codCga: "201",
  fecha: new Date("2026-08-24"),
  codigo: "68",
  concepto: "Servicio de Energia Electrica",
  importe: { toString: () => "1552076.41" },
};

function fila(overrides: Partial<CompraParaReconciliar> = {}): CompraParaReconciliar {
  return {
    ...BASE,
    rowId: "rowid-generico",
    observac: "Del 23/7 Al 24/8",
    comprobante: null,
    esDistribuido: false,
    tieneDetalleCompras: false,
    ...overrides,
  };
}

describe("planReconciliacionDuplicados", () => {
  it("grupo de 2 sin distribuidas: sobrevive la de OBSERVAC más largo, la otra va a rowIdABorrar", () => {
    const corta = fila({ rowId: "corta", observac: "Turbina Inflable" });
    const larga = fila({ rowId: "larga", observac: "Turbina Inflable Nuevo" });
    const plan = planReconciliacionDuplicados([corta, larga]);
    expect(plan.rowIdABorrar).toEqual(["corta"]);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });

  it("grupo de 2 con exactamente 1 esDistribuido=true: esa sobrevive siempre, aunque su OBSERVAC sea más corto", () => {
    const distribuida = fila({ rowId: "distribuida", observac: "Cable Para Alargues Kids Park", esDistribuido: true });
    const noDistribuida = fila({ rowId: "no-distribuida", observac: "Cable Para Alargues Kids Park 50%" });
    const plan = planReconciliacionDuplicados([distribuida, noDistribuida]);
    expect(plan.rowIdABorrar).toEqual(["no-distribuida"]);
  });

  it("empate de longitud de observac sin distribuidas: grupo excluido, no se borra nada", () => {
    const a = fila({ rowId: "a", observac: "Mochila Baño Vestuario" });
    const b = fila({ rowId: "b", observac: "Valvula Descarga Baños" }); // mismo largo (22) a propósito
    const plan = planReconciliacionDuplicados([a, b]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("empate de longitud de observac, revisar a mano");
  });

  it("ambas filas con esDistribuido=true: grupo excluido, revisar a mano", () => {
    const a = fila({ rowId: "a", esDistribuido: true });
    const b = fila({ rowId: "b", esDistribuido: true });
    const plan = planReconciliacionDuplicados([a, b]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos[0].motivo).toBe("ambas filas tienen esDistribuido=true, revisar a mano");
  });

  it("la fila a descartar tiene detalle_compras propio: grupo excluido", () => {
    const corta = fila({ rowId: "corta", observac: "A", tieneDetalleCompras: true });
    const larga = fila({ rowId: "larga", observac: "AB" });
    const plan = planReconciliacionDuplicados([corta, larga]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos[0].motivo).toBe("la fila a descartar tiene detalle_compras propio");
  });

  it("grupo de 3+ filas con la misma ancla: forma inesperada, excluido", () => {
    const plan = planReconciliacionDuplicados([
      fila({ rowId: "a" }), fila({ rowId: "b" }), fila({ rowId: "c" }),
    ]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos[0].motivo).toBe("forma inesperada (no son 2 filas)");
  });

  it("sin duplicados: plan vacío", () => {
    const plan = planReconciliacionDuplicados([fila({ rowId: "unica" })]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });

  it("mismo comprobante y observaciones sin relación de prefijo: grupo excluido (caso real Mochila/Válvula, spec §1)", () => {
    // Strings literales de la spec — 22 vs 29 caracteres, NO empatan en
    // longitud. Sin el chequeo de prefijo, la regla de "gana el más largo"
    // elegiría "Valvula..." y borraría "Mochila...", que es una compra real
    // y distinta (misma factura, 2 ítems).
    const mochila = fila({ rowId: "mochila", observac: "Mochila Baño Vestuario", comprobante: "0001-00001234" });
    const valvula = fila({ rowId: "valvula", observac: "Valvula + Tecla Descarga Baño", comprobante: "0001-00001234" });
    const plan = planReconciliacionDuplicados([mochila, valvula]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe(
      "ambas con comprobante, observaciones sin relación de texto clara — revisar a mano"
    );
  });

  it("mismo comprobante y observac corto es prefijo del largo: sigue reconciliando normal", () => {
    const corta = fila({ rowId: "corta", observac: "Turbina Inflable", comprobante: "0002-00005678" });
    const larga = fila({ rowId: "larga", observac: "Turbina Inflable Nuevo", comprobante: "0002-00005678" });
    const plan = planReconciliacionDuplicados([corta, larga]);
    expect(plan.rowIdABorrar).toEqual(["corta"]);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });

  it("importe nulo: la fila nunca entra en ningún grupo (ni sobrevive ni se borra)", () => {
    const conImporteNulo1 = fila({ rowId: "nulo-1", importe: null });
    const conImporteNulo2 = fila({ rowId: "nulo-2", importe: null });
    const plan = planReconciliacionDuplicados([conImporteNulo1, conImporteNulo2]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });
});
