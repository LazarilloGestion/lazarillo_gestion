import { describe, it, expect } from "vitest";
import { planRowIdMigration } from "./migrate-rowid-compras";

describe("planRowIdMigration", () => {
  it("calcula un rowId nuevo distinto del actual cuando la fórmula cambia el resultado", () => {
    const compras = [
      {
        rowId: "hash-viejo-1",
        codCga: "GASTO1",
        fecha: new Date("2026-03-15"),
        codigo: "PROV1",
        concepto: "Alquiler",
        comprobante: "A060600761530",
        detalle: "A 0606-00761530",
        observac: "Obs",
        importe: { toString: () => "1000" },
      },
    ];
    const plan = planRowIdMigration(compras);
    expect(plan).toHaveLength(1);
    expect(plan[0].rowIdViejo).toBe("hash-viejo-1");
    expect(plan[0].rowIdNuevo).not.toBe("hash-viejo-1");
    expect(plan[0].rowIdNuevo).toMatch(/^[0-9a-f]{24}$/);
  });

  it("no genera un plan de migración duplicado si dos compras distintas ya comparten rowIdNuevo (colisión) — se marca para revisión manual", () => {
    const filaBase = {
      codCga: "GASTO1",
      fecha: new Date("2026-03-15"),
      codigo: "PROV1",
      concepto: "Alquiler",
      comprobante: "A060600761530",
      detalle: "A 0606-00761530",
      observac: "Obs",
      importe: { toString: () => "1000" },
    };
    const compras = [
      { ...filaBase, rowId: "hash-viejo-1" },
      { ...filaBase, rowId: "hash-viejo-2", importe: { toString: () => "2000" } }, // con comprobante, importe no entra al hash -> misma identidad
    ];
    const plan = planRowIdMigration(compras);
    const colisiones = plan.filter((p) => p.colision);
    expect(colisiones.length).toBeGreaterThan(0);
  });

  it("es idempotente: si el rowId ya es el nuevo formato, no lo incluye en el plan", () => {
    const compra = {
      rowId: "hash-viejo-1",
      codCga: "GASTO1",
      fecha: new Date("2026-03-15"),
      codigo: "PROV1",
      concepto: "Alquiler",
      comprobante: "A060600761530",
      detalle: "A 0606-00761530",
      observac: "Obs",
      importe: { toString: () => "1000" },
    };
    const primerPlan = planRowIdMigration([compra]);
    const yaMigrada = { ...compra, rowId: primerPlan[0].rowIdNuevo };
    const segundoPlan = planRowIdMigration([yaMigrada]);
    expect(segundoPlan).toHaveLength(0);
  });
});
