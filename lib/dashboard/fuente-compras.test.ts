import { describe, it, expect } from "vitest";
import { fuenteCompras } from "./fuente-compras";
import { compraRowSchema } from "@/lib/etl/schemas/compras";

describe("switch Económica / Financiera", () => {
  it("Económica: sueldos por PERIODO, la fecha editada en Lazarillo sigue mandando", () => {
    const sql = fuenteCompras("economica").sql;
    expect(sql).toContain('COALESCE(co.periodo, v.fecha) AS fecha');
    expect(sql).toContain('v."fechaManual"');
    expect(sql).not.toContain("pagos");
  });
  it("Financiera: gastos varios por fecha de pago, facturas una fila por pago del 80", () => {
    const q = fuenteCompras("financiera", "2025-09-01");
    expect(q.sql).toContain('COALESCE(b.fpago, b."fechaManual", b.fecha) AS fecha');
    expect(q.sql).toContain('pg."fechaPago" AS fecha');
    expect(q.sql).toContain("FROM pagos");
    expect(q.values).toContain("2025-09-01");
  });
});

describe("14 con las columnas nuevas del kit", () => {
  const base = { COD_CGA: "885", FECHA: 46024, IMPORTE: 1000 };
  it("lee FECHA_PAGO, CAJA_PAGO y PERIODO", () => {
    const r = compraRowSchema.parse({ ...base, FECHA_PAGO: 46027, CAJA_PAGO: "CAJA MAYOR", PERIODO: 45992 });
    expect(r.FECHA_PAGO?.toISOString().slice(0, 10)).toBe("2026-01-05");
    expect(r.CAJA_PAGO).toBe("CAJA MAYOR");
    expect(r.PERIODO?.toISOString().slice(0, 10)).toBe("2025-12-01");
  });
  it("un 14 viejo sin las columnas, o con una fecha rota, no tira la fila", () => {
    expect(compraRowSchema.parse(base).FECHA_PAGO).toBeNull();
    expect(compraRowSchema.parse({ ...base, FECHA_PAGO: "basura" }).FECHA_PAGO).toBeNull();
  });
});
