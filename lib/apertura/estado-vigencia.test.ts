import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  estadoVigenciaRegla,
  resumenVigencia,
  ordenarReglas,
  hayReglaVigente,
  hoyUTC,
  formatFechaRegla,
  formatPorcentaje,
  cubreFecha,
} from "./estado-vigencia";
import { fechaEnVigencia, type ReglaVigencia } from "./vigencia";
import type { ReglaAperturaDTO } from "./types";

// Guardia del incidente 21/10/2026 (PR #2): este módulo lo carga el navegador
// y vigencia.ts arrastra @prisma/client (y evalúa Prisma.sql al importar).
// Si alguien vuelve a importarlo desde acá, que falle el test y no producción.
describe("estado-vigencia es seguro para el navegador", () => {
  it("no importa ./vigencia ni @prisma/client", () => {
    const src = readFileSync(join(__dirname, "estado-vigencia.ts"), "utf8");
    const imports = src.split("\n").filter((l) => /^\s*import\s/.test(l));
    expect(imports.some((l) => l.includes("./vigencia\"") || l.includes("@prisma/client"))).toBe(false);
  });
});

describe("cubreFecha replica la semántica de fechaEnVigencia", () => {
  const fechas = ["2026-01-01", "2026-06-30", "2026-07-01", "2026-09-30", "2026-10-01", "2026-12-31"].map((d) => new Date(`${d}T00:00:00.000Z`));
  const desde = new Date("2026-07-01T00:00:00.000Z");
  const hasta = new Date("2026-09-30T00:00:00.000Z");
  const casos: ReglaVigencia[] = [];
  for (const inc of [true, false]) {
    casos.push({ modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: inc });
    casos.push({ modo: "entre_fechas", fechaDesde: desde, fechaHasta: hasta, extremosInclusivos: inc });
    casos.push({ modo: "desde_adelante", fechaDesde: desde, fechaHasta: null, extremosInclusivos: inc });
    casos.push({ modo: "desde_atras", fechaDesde: null, fechaHasta: hasta, extremosInclusivos: inc });
  }
  it("mismo resultado en todos los modos, extremos y fechas de borde", () => {
    for (const r of casos) {
      for (const f of fechas) {
        expect(cubreFecha(f, r, r.fechaDesde, r.fechaHasta), `${r.modo} inc=${r.extremosInclusivos} ${f.toISOString()}`).toBe(fechaEnVigencia(f, r));
      }
    }
  });
  it("dato inconsistente: null en vez de tirar", () => {
    expect(cubreFecha(fechas[0], { modo: "entre_fechas", extremosInclusivos: true }, null, null)).toBeNull();
  });
});

const HOY = new Date("2026-10-21T00:00:00.000Z");

function regla(overrides: Partial<ReglaAperturaDTO> = {}): ReglaAperturaDTO {
  return {
    id: 1,
    nivel: "proveedor",
    entidadId: "3572",
    origenLocalId: 1,
    origenPuntoDeVentaId: 1,
    modo: "historico",
    fechaDesde: null,
    fechaHasta: null,
    extremosInclusivos: true,
    estado: "activa",
    creadoPor: null,
    creadoEn: "2026-01-01T00:00:00.000Z",
    destinos: [],
    ...overrides,
  };
}

describe("estadoVigenciaRegla", () => {
  it("histórico completo activa → vigente", () => {
    expect(estadoVigenciaRegla(regla(), HOY)).toBe("vigente");
  });

  it("entre_fechas que cubre hoy → vigente; que terminó ayer → vencida (caso real Vanesa Judit, hasta 30/09/2026)", () => {
    expect(estadoVigenciaRegla(regla({ modo: "entre_fechas", fechaDesde: "2026-07-01T00:00:00.000Z", fechaHasta: "2026-12-31T00:00:00.000Z" }), HOY)).toBe("vigente");
    expect(estadoVigenciaRegla(regla({ modo: "entre_fechas", fechaDesde: "2026-07-01T00:00:00.000Z", fechaHasta: "2026-09-30T00:00:00.000Z" }), HOY)).toBe("vencida");
  });

  it("extremos: hasta = hoy es vigente si inclusivo y vencida si exclusivo", () => {
    const base = { modo: "entre_fechas" as const, fechaDesde: "2026-01-01T00:00:00.000Z", fechaHasta: "2026-10-21T00:00:00.000Z" };
    expect(estadoVigenciaRegla(regla({ ...base, extremosInclusivos: true }), HOY)).toBe("vigente");
    expect(estadoVigenciaRegla(regla({ ...base, extremosInclusivos: false }), HOY)).toBe("vencida");
  });

  it("desde_adelante sin fecha de fin → vigente si ya arrancó, próxima si arranca después de hoy", () => {
    expect(estadoVigenciaRegla(regla({ modo: "desde_adelante", fechaDesde: "2026-10-01T00:00:00.000Z" }), HOY)).toBe("vigente");
    expect(estadoVigenciaRegla(regla({ modo: "desde_adelante", fechaDesde: "2026-11-01T00:00:00.000Z" }), HOY)).toBe("proxima");
  });

  it("desde_atras → vigente hasta su fecha de fin, vencida después", () => {
    expect(estadoVigenciaRegla(regla({ modo: "desde_atras", fechaHasta: "2026-12-31T00:00:00.000Z" }), HOY)).toBe("vigente");
    expect(estadoVigenciaRegla(regla({ modo: "desde_atras", fechaHasta: "2026-06-30T00:00:00.000Z" }), HOY)).toBe("vencida");
  });

  it("estado inactiva manda sobre cualquier fecha", () => {
    expect(estadoVigenciaRegla(regla({ estado: "inactiva" }), HOY)).toBe("inactiva");
    expect(estadoVigenciaRegla(regla({ estado: "inactiva", modo: "entre_fechas", fechaDesde: "2026-01-01T00:00:00.000Z", fechaHasta: "2026-12-31T00:00:00.000Z" }), HOY)).toBe("inactiva");
  });

  it("dato inconsistente (entre_fechas sin fechas) no revienta y no se da por vigente", () => {
    expect(estadoVigenciaRegla(regla({ modo: "entre_fechas" }), HOY)).toBe("vencida");
  });
});

describe("hoyUTC", () => {
  it("usa el día calendario local a medianoche UTC (a la noche en Argentina no salta a mañana)", () => {
    // 21/10 23:30 hora local del proceso → 21/10 00:00Z, no 22/10
    const ahora = new Date(2026, 9, 21, 23, 30);
    expect(hoyUTC(ahora).toISOString()).toBe("2026-10-21T00:00:00.000Z");
  });
});

describe("resumenVigencia / formatFechaRegla", () => {
  it("fechas en dd/mm/aaaa sin corrimiento de zona horaria", () => {
    expect(formatFechaRegla("2026-09-30T00:00:00.000Z")).toBe("30/09/2026");
    expect(formatFechaRegla(null)).toBeNull();
  });

  it("textos por modo", () => {
    expect(resumenVigencia(regla())).toBe("Histórico completo");
    expect(resumenVigencia(regla({ modo: "entre_fechas", fechaDesde: "2026-07-01T00:00:00.000Z", fechaHasta: "2026-09-30T00:00:00.000Z" }))).toBe("01/07/2026 — 30/09/2026");
    expect(resumenVigencia(regla({ modo: "desde_adelante", fechaDesde: "2026-10-01T00:00:00.000Z" }))).toBe("Desde 01/10/2026 · sin fecha de fin");
    expect(resumenVigencia(regla({ modo: "desde_atras", fechaHasta: "2026-06-30T00:00:00.000Z" }))).toBe("Sin fecha de inicio · hasta 30/06/2026");
  });
});

describe("ordenarReglas", () => {
  it("de la más nueva a la más vieja por inicio de vigencia; histórico al final; empate por creación", () => {
    const vieja = regla({ id: 1, modo: "entre_fechas", fechaDesde: "2025-01-01T00:00:00.000Z", fechaHasta: "2025-12-31T00:00:00.000Z", creadoEn: "2026-10-01T00:00:00.000Z" });
    const nueva = regla({ id: 2, modo: "desde_adelante", fechaDesde: "2026-10-01T00:00:00.000Z", creadoEn: "2026-01-01T00:00:00.000Z" });
    const historica = regla({ id: 3, modo: "historico", creadoEn: "2026-05-01T00:00:00.000Z" });
    const historica2 = regla({ id: 4, modo: "historico", creadoEn: "2026-06-01T00:00:00.000Z" });
    const orden = ordenarReglas([vieja, historica, nueva, historica2]).map((r) => r.id);
    expect(orden).toEqual([2, 1, 4, 3]);
  });

  it("no muta el array original", () => {
    const lista = [regla({ id: 1 }), regla({ id: 2, modo: "desde_adelante", fechaDesde: "2026-10-01T00:00:00.000Z" })];
    ordenarReglas(lista);
    expect(lista.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("formatPorcentaje", () => {
  it("sin decimales de relleno, coma decimal es-AR", () => {
    expect(formatPorcentaje("50.00")).toBe("50");
    expect(formatPorcentaje("33.33")).toBe("33,33");
    expect(formatPorcentaje("abc")).toBe("abc");
  });
});

describe("hayReglaVigente", () => {
  it("false cuando todas vencieron (aviso 'ninguna regla vigente'), true con una que cubre hoy", () => {
    const vencida = regla({ modo: "entre_fechas", fechaDesde: "2026-07-01T00:00:00.000Z", fechaHasta: "2026-09-30T00:00:00.000Z" });
    expect(hayReglaVigente([vencida], HOY)).toBe(false);
    expect(hayReglaVigente([vencida, regla()], HOY)).toBe(true);
    expect(hayReglaVigente([], HOY)).toBe(false);
  });
});
