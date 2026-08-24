import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  excelDecimal,
  excelDate,
  excelInt,
  excelBool,
  excelText,
  excelNormalizedText,
  excelPhone,
  excelCuit,
  requiredExcelText,
  requiredExcelDate,
} from "./common";

// XLSX.utils.sheet_to_json omite la key del todo cuando una celda está en blanco
// (no le pone `undefined`) — por eso estos tests parsean `{}`, no `{FIELD: undefined}`.
// Bajo Zod 3 esto funcionaba con los helpers tolerantes tal como estaban; Zod 4 (repo
// en ^4.4.3) trata una key ausente en z.unknown() como "expected nonoptional" salvo que
// el schema declare .optional() explícitamente — regresión real detectada en producción
// el 24-ago-2026 (Rubros Artículo/Subrubros Articulo/Proveedores fallando 100% de filas).
describe("helpers tolerantes — celda en blanco (key ausente del objeto, no undefined explícito)", () => {
  it("excelDecimal acepta key ausente y da null", () => {
    const r = z.object({ FIELD: excelDecimal }).safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.FIELD).toBeNull();
  });

  it("excelDate acepta key ausente y da null", () => {
    const r = z.object({ FIELD: excelDate }).safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.FIELD).toBeNull();
  });

  it("excelInt acepta key ausente y da null", () => {
    const r = z.object({ FIELD: excelInt }).safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.FIELD).toBeNull();
  });

  it("excelBool acepta key ausente y da null", () => {
    const r = z.object({ FIELD: excelBool }).safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.FIELD).toBeNull();
  });

  it("excelText acepta key ausente y da null", () => {
    const r = z.object({ FIELD: excelText }).safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.FIELD).toBeNull();
  });

  it("excelNormalizedText acepta key ausente y da null", () => {
    const r = z.object({ FIELD: excelNormalizedText }).safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.FIELD).toBeNull();
  });

  it("excelPhone acepta key ausente y da null", () => {
    const r = z.object({ FIELD: excelPhone }).safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.FIELD).toBeNull();
  });

  it("excelCuit acepta key ausente y da null", () => {
    const r = z.object({ FIELD: excelCuit }).safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.FIELD).toBeNull();
  });
});

describe("helpers tolerantes — key presente sigue funcionando igual que antes", () => {
  it("excelDecimal con valor numérico string lo conserva", () => {
    const r = z.object({ FIELD: excelDecimal }).safeParse({ FIELD: "123.45" });
    expect(r.success && r.data.FIELD).toBe("123.45");
  });

  it("excelDecimal con basura no numérica sigue fallando (no se relaja la validación real)", () => {
    const r = z.object({ FIELD: excelDecimal }).safeParse({ FIELD: "abc" });
    expect(r.success).toBe(false);
  });

  it("excelInt con valor entero lo convierte a number", () => {
    const r = z.object({ FIELD: excelInt }).safeParse({ FIELD: "30" });
    expect(r.success && r.data.FIELD).toBe(30);
  });

  it("excelBool con '1' da true", () => {
    const r = z.object({ FIELD: excelBool }).safeParse({ FIELD: "1" });
    expect(r.success && r.data.FIELD).toBe(true);
  });

  it("excelText trimea sin capitalizar", () => {
    const r = z.object({ FIELD: excelText }).safeParse({ FIELD: "  hola mundo  " });
    expect(r.success && r.data.FIELD).toBe("hola mundo");
  });
});

describe("helpers obligatorios — key ausente ya rechazaba correctamente antes del fix, sigue igual", () => {
  it("requiredExcelText rechaza key ausente con mensaje propio (no el genérico de Zod)", () => {
    const r = z.object({ FIELD: requiredExcelText }).safeParse({});
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toBe("Campo obligatorio faltante");
  });

  it("requiredExcelDate rechaza key ausente con mensaje propio", () => {
    const r = z.object({ FIELD: requiredExcelDate }).safeParse({});
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toBe("Fecha obligatoria inválida o faltante");
  });
});
