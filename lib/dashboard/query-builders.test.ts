import { describe, it, expect } from "vitest";
import { buildPivotConditions } from "./query-builders";

const sqlDe = (conds: ReturnType<typeof buildPivotConditions>) => conds.map((c) => c.sql).join(" AND ");

describe("buildPivotConditions — año", () => {
  it("con año filtra por ese año (comportamiento del pivot)", () => {
    expect(sqlDe(buildPivotConditions({ year: 2025, tableAlias: "c" }))).toContain("EXTRACT(YEAR FROM");
  });

  it("sin año no filtra por año: la búsqueda recorre todos los años", () => {
    expect(sqlDe(buildPivotConditions({ tableAlias: "c" }))).not.toContain("EXTRACT(YEAR FROM");
  });

  it("sin año igual exige fecha e importe efectivos distintos de 0", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c" }));
    expect(sql).toContain(`"fechaManual" IS NOT NULL`);
    expect(sql).toContain("!= 0");
  });
});

describe("buildPivotConditions — origen", () => {
  it("sin local ni PDV no agrega predicados de origen", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c" }));
    expect(sql).not.toContain(`"localId"`);
    expect(sql).not.toContain(`"puntoDeVentaId"`);
  });

  it("con local y PDV agrega ambos predicados", () => {
    const conds = buildPivotConditions({ tableAlias: "c", localId: 3, pdvId: 7 });
    const sql = sqlDe(conds);
    expect(sql).toContain(`c."localId" =`);
    expect(sql).toContain(`c."puntoDeVentaId" =`);
    expect(conds.flatMap((c) => c.values)).toEqual(expect.arrayContaining([3, 7]));
  });
});
