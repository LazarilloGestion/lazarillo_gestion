import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("./db", () => ({ leerTabla: vi.fn() }));
import { elegirHuerfanas } from "./huerfanas";

const filas = (mes: string, n: number, prefijo = "r") => Array.from({ length: n }, (_, i) => ({ rowId: `${prefijo}${mes}-${i}`, mes }));

describe("huérfanas", () => {
  it("marca las que Render no tiene, desde el mes de corte", () => {
    const panel = [...filas("2025-12", 50), ...filas("2026-09", 100)];
    const render = new Set(panel.map((p) => p.rowId));
    render.delete("r2026-09-3"); render.delete("r2026-09-7"); render.delete("r2025-12-1");
    const r = elegirHuerfanas(panel, render, "2026-01");
    expect(r.elegidas.sort()).toEqual(["r2026-09-3", "r2026-09-7"]);
    expect(r.salteados).toEqual([]);
  });
  it("si faltan muchas en un mes (foto incompleta), ese mes no se toca", () => {
    const panel = filas("2026-03", 100);
    const render = new Set(panel.slice(0, 80).map((p) => p.rowId)); // faltan 20 (20%)
    const r = elegirHuerfanas(panel, render, "2026-01");
    expect(r.elegidas).toEqual([]);
    expect(r.salteados).toEqual(["2026-03 (20 de 100)"]);
  });
  it("en meses chicos tolera hasta 3", () => {
    const panel = filas("2026-02", 10);
    const render = new Set(panel.slice(0, 7).map((p) => p.rowId));
    expect(elegirHuerfanas(panel, render, "2026-01").elegidas).toHaveLength(3);
  });
});
