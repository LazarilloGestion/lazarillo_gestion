import { describe, it, expect } from "vitest";
import { planificarBackfill, resumirPlan, type CompraNcCandidata } from "./backfill-signo-notas-credito";

function fila(overrides: Partial<CompraNcCandidata> = {}): CompraNcCandidata {
  return {
    rowId: "r1",
    fecha: "2024-06-27",
    detalle: "NcB 0004-00004607",
    importe: "287999",
    esDistribuido: false,
    importeManual: null,
    ...overrides,
  };
}

describe("planificarBackfill", () => {
  it("invierte una NcB positiva no distribuida", () => {
    const plan = planificarBackfill([fila()]);
    expect(plan.invertir.map((f) => f.rowId)).toEqual(["r1"]);
    expect(plan.omitidas).toEqual([]);
  });

  it("omite la NC distribuida (apertura aplicada) con motivo, no la invierte", () => {
    const plan = planificarBackfill([fila({ rowId: "dist", esDistribuido: true })]);
    expect(plan.invertir).toEqual([]);
    expect(plan.omitidas).toEqual([expect.objectContaining({ rowId: "dist", motivo: "distribuida" })]);
  });

  it("omite la NC con importe manual (override del usuario) con motivo", () => {
    const plan = planificarBackfill([fila({ rowId: "man", importeManual: "500" })]);
    expect(plan.invertir).toEqual([]);
    expect(plan.omitidas).toEqual([expect.objectContaining({ rowId: "man", motivo: "importe_manual" })]);
  });

  it("ignora filas que no son NC aunque vengan en la lista", () => {
    const plan = planificarBackfill([fila({ rowId: "fc", detalle: "FcA 0004-00507298" })]);
    expect(plan.invertir).toEqual([]);
    expect(plan.omitidas).toEqual([]);
  });

  it("ignora una NC que ya es negativa o cero (idempotente: re-correr no hace nada)", () => {
    const plan = planificarBackfill([fila({ rowId: "neg", importe: "-100" }), fila({ rowId: "cero", importe: "0" })]);
    expect(plan.invertir).toEqual([]);
    expect(plan.omitidas).toEqual([]);
  });
});

describe("resumirPlan", () => {
  it("sin nada para hacer, lo dice", () => {
    expect(resumirPlan({ invertir: [], omitidas: [] })).toMatch(/nada que invertir/i);
  });

  it("reporta cantidad, total a invertir y las omitidas con su motivo", () => {
    const texto = resumirPlan({
      invertir: [fila({ rowId: "a", importe: "100.50" }), fila({ rowId: "b", importe: "200" })],
      omitidas: [{ ...fila({ rowId: "d", importe: "30600", detalle: "NcB 0015-00000016" }), motivo: "distribuida" }],
    });
    expect(texto).toMatch(/2 notas de crédito/);
    expect(texto).toMatch(/300\.5/);
    expect(texto).toMatch(/NcB 0015-00000016/);
    expect(texto).toMatch(/distribuida/);
  });
});
