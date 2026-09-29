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
    localId: 1,
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

  it("1 esDistribuido=true con comprobante compartido y observaciones sin relación de prefijo: grupo excluido, no se elige automáticamente a la distribuida", () => {
    // Mismo riesgo que el caso Mochila/Válvula (0 distribuidas) pero en la
    // rama de 1 distribuida: sin este chequeo, la distribuida ganaría
    // siempre sin importar el texto, y podría borrarse una compra real y
    // distinta que comparte comprobante por casualidad.
    const mochilaDistribuida = fila({
      rowId: "mochila-distribuida",
      observac: "Mochila Baño Vestuario",
      comprobante: "0004-00001111",
      esDistribuido: true,
    });
    const valvula = fila({
      rowId: "valvula",
      observac: "Valvula + Tecla Descarga Baño",
      comprobante: "0004-00001111",
    });
    const plan = planReconciliacionDuplicados([mochilaDistribuida, valvula]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe(
      "esDistribuido difiere pero observaciones sin relación de texto clara — revisar a mano"
    );
  });

  it("1 esDistribuido=true con comprobante compartido y relación de prefijo: sigue fusionando normal", () => {
    const distribuida = fila({
      rowId: "turbina-distribuida",
      observac: "Turbina Inflable",
      comprobante: "0005-00002222",
      esDistribuido: true,
    });
    const noDistribuida = fila({
      rowId: "turbina-no-distribuida",
      observac: "Turbina Inflable Nuevo",
      comprobante: "0005-00002222",
    });
    const plan = planReconciliacionDuplicados([distribuida, noDistribuida]);
    expect(plan.rowIdABorrar).toEqual(["turbina-no-distribuida"]);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });

  it("observac vacío/null del lado que se borra pasa el chequeo de prefijo trivialmente (documentado, no bloqueado)", () => {
    // String.prototype.startsWith("") siempre da true, así que un observac
    // vacío/null del lado más corto pasa el chequeo de relación de prefijo
    // sin decir nada sobre el texto. No se bloquea porque ya requiere
    // comprobante compartido — una señal real por sí sola — pero queda
    // documentado acá para que el comportamiento sea explícito, no implícito.
    const sinObservac = fila({ rowId: "sin-observac", observac: null, comprobante: "0006-00003333" });
    const conObservac = fila({
      rowId: "con-observac",
      observac: "Factura de luz completa",
      comprobante: "0006-00003333",
    });
    const plan = planReconciliacionDuplicados([sinObservac, conObservac]);
    expect(plan.rowIdABorrar).toEqual(["sin-observac"]);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });

  // Hallazgo Critical #1 de la revisión final de rama, 29-sep-2026: el guard
  // anterior (mismoComprobante = a.comprobante != null && a.comprobante ===
  // b.comprobante) quedaba trivialmente OK cuando los comprobantes eran
  // distintos (mismoComprobante daba false), dejando pasar la fusión sin
  // chequeo. Dos comprobantes no nulos y distintos son evidencia fuerte de
  // dos compras reales distintas — ninguno de los dos mecanismos de este
  // feature (comprobante que aparece después, observac que se corrige)
  // produce dos comprobantes no nulos distintos para la misma compra real.
  it("comprobantes no nulos y distintos: grupo excluido, revisar a mano (sin importar esDistribuido ni el texto)", () => {
    const a = fila({ rowId: "a", comprobante: "A060600761530" });
    const b = fila({ rowId: "b", comprobante: "B000100000001" });
    const plan = planReconciliacionDuplicados([a, b]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("comprobantes distintos, revisar a mano");
  });

  it("comprobantes no nulos y distintos con 1 esDistribuido=true: sigue excluido, no gana la distribuida automáticamente", () => {
    const a = fila({ rowId: "a", comprobante: "A060600761530", esDistribuido: true });
    const b = fila({ rowId: "b", comprobante: "B000100000001" });
    const plan = planReconciliacionDuplicados([a, b]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos[0].motivo).toBe("comprobantes distintos, revisar a mano");
  });

  // Hallazgo Critical #2: ni computeCompraAnchor (reconciliación hacia
  // adelante) ni claveAncla (este script) incluyen localId en el
  // agrupamiento — dos compras de LOCALES distintos podrían compartir
  // codCga+fecha+codigo+concepto+importe por casualidad (ERPs de distintos
  // negocios reusan códigos de proveedor/concepto — ver memoria del
  // proyecto, incidente Alta Nuñez-Comercio) sin ser la misma transacción.
  it("localId distinto entre las dos filas del grupo: grupo excluido, revisar a mano", () => {
    const a = fila({ rowId: "a", localId: 1 });
    const b = fila({ rowId: "b", localId: 2 });
    const plan = planReconciliacionDuplicados([a, b]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("localId distinto, revisar a mano");
  });

  // Hallazgo Important #5: para el caso "comprobante aparece después" (una
  // fila sin comprobante, la otra con el mismo OBSERVAC pero comprobante ya
  // cargado, ninguna distribuida) la regla de "gana el observac más largo"
  // caía casi siempre en el empate (mismo texto, solo cambió comprobante) y
  // el grupo nunca se limpiaba — pese a ser el caso más inequívoco del
  // diseño. La fila CON comprobante debe ganar sin importar longitud/empate.
  it("branch-flip: una fila sin comprobante y la otra con comprobante, mismo OBSERVAC, ninguna distribuida: sobrevive la que tiene comprobante (ya no queda excluido por empate)", () => {
    const sinComprobante = fila({ rowId: "sin-comprobante", comprobante: null, observac: "Servicio de luz" });
    const conComprobante = fila({ rowId: "con-comprobante", comprobante: "A060600761530", observac: "Servicio de luz" });
    const plan = planReconciliacionDuplicados([sinComprobante, conComprobante]);
    expect(plan.rowIdABorrar).toEqual(["sin-comprobante"]);
    expect(plan.paresReconciliados).toEqual([{ rowIdABorrar: "sin-comprobante", rowIdSobreviviente: "con-comprobante" }]);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });

  it("branch-flip: sigue ganando la fila con comprobante aunque su OBSERVAC sea más corto que el de la fila sin comprobante", () => {
    const sinComprobante = fila({ rowId: "sin-comprobante", comprobante: null, observac: "Servicio de luz, período largo con detalle extra" });
    const conComprobante = fila({ rowId: "con-comprobante", comprobante: "A060600761530", observac: "Servicio de luz" });
    const plan = planReconciliacionDuplicados([sinComprobante, conComprobante]);
    expect(plan.rowIdABorrar).toEqual(["sin-comprobante"]);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });
});
