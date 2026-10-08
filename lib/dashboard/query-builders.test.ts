import { describe, it, expect } from "vitest";
import { buildPivotConditions, sinRubroVisibleSql } from "./query-builders";

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

describe("buildPivotConditions — observación", () => {
  it("busca por contenido ignorando acentos en la observación efectiva", () => {
    const conds = buildPivotConditions({ tableAlias: "c", observacionQuery: "eléctrico" });
    expect(sqlDe(conds)).toContain(`translate(COALESCE(c."observacManual", c.observac),`);
    expect(sqlDe(conds)).toContain("ILIKE");
    expect(conds.flatMap((c) => c.values)).toContain("%electrico%");
  });

  it("escapa los comodines de LIKE tipeados por el usuario", () => {
    const conds = buildPivotConditions({ tableAlias: "c", observacionQuery: "50%_a" });
    expect(conds.flatMap((c) => c.values)).toContain("%50\\%\\_a%");
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

describe("buildPivotConditions — visibilidad de Sin Rubro", () => {
  it("Compras: consulta sin_rubro_config con la columna del dashboard y default true", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c", filterRubrosOcultos: true }));
    expect(sql).toContain("sin_rubro_config");
    expect(sql).toContain(`s."visibleEnDashboard"`);
    expect(sql).toMatch(/,\s*true\)/);
  });

  it("Resultados: consulta la columna de resultados y default false", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c", filterRubrosOcultos: true, visibilidadCol: "visibleEnResultados" }));
    expect(sql).toContain(`s."visibleEnResultados"`);
    expect(sql).not.toContain(`s."visibleEnDashboard"`);
    expect(sql).toMatch(/,\s*false\)/);
  });

  it("ya no deja Sin Rubro incondicionalmente visible (rc.codigo IS NULL va atado al flag)", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c", filterRubrosOcultos: true }));
    expect(sql).toContain("rc.codigo IS NULL AND");
  });

  it("sin filterRubrosOcultos no consulta la config", () => {
    expect(sqlDe(buildPivotConditions({ tableAlias: "c" }))).not.toContain("sin_rubro_config");
  });

  it("con rubroCodigo explícito no consulta la config (el usuario pidió ese bucket)", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c", filterRubrosOcultos: true, rubroCodigo: "__sin_rubro" }));
    expect(sql).not.toContain("sin_rubro_config");
  });
});

describe("sinRubroVisibleSql", () => {
  it("una columna fuera de la whitelist cae al dashboard, nunca se interpola cruda", () => {
    const frag = sinRubroVisibleSql("x; DROP TABLE compras" as never);
    expect(frag.sql).toContain(`s."visibleEnDashboard"`);
    expect(frag.sql).not.toContain("DROP");
  });
});
