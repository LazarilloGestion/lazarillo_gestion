import { describe, it, expect } from "vitest";
import { buildDetalleConditions } from "./detalle-conditions";

const base = { year: 2026, sinProveedor: false };
const sqlDe = (conds: ReturnType<typeof buildDetalleConditions>) => conds.map((c) => c.sql).join(" AND ");
const valuesDe = (conds: ReturnType<typeof buildDetalleConditions>) => conds.flatMap((c) => c.values);

describe("buildDetalleConditions — visibilidad", () => {
  it("sin rubro ni concepto: oculta por rubro EFECTIVO (mismo criterio que el pivot)", () => {
    const sql = sqlDe(buildDetalleConditions(base));
    expect(sql).toContain(`rc_ef."visibleEnDashboard" = true`);
    expect(sql).toContain("rc_ef.codigo IS NULL");
    expect(sql).not.toContain(`rc."visibleEnDashboard"`);
    expect(sql).not.toContain(`c."conceptoCodigo" IS NULL`);
  });

  it("con rubro: filtra por rubro efectivo con bucket Sin Rubro, sin filtro de visibilidad", () => {
    const conds = buildDetalleConditions({ ...base, rubroCodigo: "R1" });
    expect(sqlDe(conds)).toContain("COALESCE(rc_ef.codigo, '__sin_rubro') =");
    expect(valuesDe(conds)).toContain("R1");
    expect(sqlDe(conds)).not.toContain("visibleEnDashboard");
  });

  it("con concepto: gana sobre rubro", () => {
    const conds = buildDetalleConditions({ ...base, rubroCodigo: "R1", conceptoCodigo: "C1" });
    expect(sqlDe(conds)).toContain(`COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") =`);
    expect(valuesDe(conds)).toContain("C1");
    expect(valuesDe(conds)).not.toContain("R1");
  });
});

describe("buildDetalleConditions — período", () => {
  it("con meses y sin mes: filtra el año y esos meses", () => {
    const conds = buildDetalleConditions({ ...base, meses: [1, 3] });
    expect(sqlDe(conds)).toContain("EXTRACT(MONTH FROM");
    expect(valuesDe(conds)).toEqual(expect.arrayContaining([1, 3, new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2027, 0, 1))]));
  });

  it("con mes: rango de ese mes y se ignoran los meses", () => {
    const conds = buildDetalleConditions({ ...base, mes: 3, meses: [1, 3] });
    expect(sqlDe(conds)).not.toContain("EXTRACT(MONTH FROM");
    expect(valuesDe(conds)).toEqual(expect.arrayContaining([new Date(Date.UTC(2026, 2, 1)), new Date(Date.UTC(2026, 3, 1))]));
  });

  it("sin mes ni meses: año completo, sin filtro de meses", () => {
    expect(sqlDe(buildDetalleConditions(base))).not.toContain("EXTRACT(MONTH FROM");
  });
});

describe("buildDetalleConditions — observación y proveedor", () => {
  it("con observación: usa el mismo ILIKE sin acentos que el pivot", () => {
    const conds = buildDetalleConditions({ ...base, observacionQuery: "eléctrico" });
    expect(sqlDe(conds)).toContain(`translate(COALESCE(c."observacManual", c.observac),`);
    expect(valuesDe(conds)).toContain("%electrico%");
  });

  it("proveedorId gana sobre proveedorTexto y sinProveedor", () => {
    const sql = sqlDe(buildDetalleConditions({ ...base, proveedorId: 5, proveedorTexto: "Diego", sinProveedor: true }));
    expect(sql).toContain("p.id =");
    expect(sql).not.toContain("c.proveedor =");
  });

  it("proveedorTexto con código acota por código", () => {
    const conds = buildDetalleConditions({ ...base, proveedorTexto: "Abril", codigo: "368" });
    expect(sqlDe(conds)).toContain("c.codigo =");
    expect(valuesDe(conds)).toEqual(expect.arrayContaining(["Abril", "368"]));
  });
});
