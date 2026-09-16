# Diferencia de Caja — Corrección Por Mes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cambiar la fila "Diferencia de caja" del Dashboard de Resultados de un modelo acumulado (cada celda arrastra el saldo desde el primer arqueo) a un modelo por-mes independiente, agregando el acumulado como dato secundario de tooltip.

**Architecture:** Cambio de cálculo puro + shape de respuesta de un endpoint de solo lectura. `computeDiferenciaCajaAcumulada` (existente) no cambia una línea — sigue siendo la fuente del acumulado. Función nueva `computeDiferenciaCajaPorMes` calcula el valor principal. `buildDiferenciaCajaSerie` corre ambas sobre la misma serie y devuelve `{ valor, acumulado }` por mes. El shape nuevo se propaga sin cambios de lógica por el endpoint, el hook y el componente.

**Tech Stack:** TypeScript estricto, Next.js API routes, Vitest, React (componente cliente).

**Spec:** `docs/superpowers/specs/2026-09-16-diferencia-caja-por-mes-design.md`

## Global Constraints

- No hay migración de Prisma ni cambio de queries SQL — todo el cambio es cálculo puro + shape de respuesta.
- `computeDiferenciaCajaAcumulada` (`lib/dashboard/resultados-calc.ts`) no se modifica — sus tests existentes deben seguir pasando sin cambios.
- Decisión de negocio confirmada (spec §1.3): en un hueco de 2+ meses sin arqueo, el mes que reabre resta **solo su propio** término contable (`ingresos − egresos − ganancia`), nunca la suma de los meses ocultos del hueco.
- Total anual = suma de los valores mensuales visibles (no-null), no el último acumulado (spec §1.4).
- El acumulado desde el primer arqueo se expone como dato secundario por celda mensual (tooltip/`title`), no reemplaza el valor principal mostrado.
- TypeScript estricto, sin `any`; ningún `catch {}` vacío (CLAUDE.md §2).
- Correr `npm run lint` y el build antes de dar cualquier tarea por cerrada (CLAUDE.md §7).

---

### Task 1: `computeDiferenciaCajaPorMes` en `lib/dashboard/resultados-calc.ts`

**Files:**
- Modify: `lib/dashboard/resultados-calc.ts` (agrega la función nueva junto a `computeDiferenciaCajaAcumulada`, ~línea 81)
- Test: `lib/dashboard/resultados-calc.test.ts` (agrega `describe("computeDiferenciaCajaPorMes", ...)` después del describe de `computeDiferenciaCajaAcumulada`, ~línea 215)

**Interfaces:**
- Consumes: `MesDatos` (ya exportado en este archivo: `{ anio, mes, ingresos, egresos, ganancia, disponible }`).
- Produces: `export function computeDiferenciaCajaPorMes(serie: MesDatos[], primerArqueo: { anio: number; mes: number } | null): (number | null)[]` — misma firma que `computeDiferenciaCajaAcumulada`, para que Task 2 la consuma igual.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `lib/dashboard/resultados-calc.test.ts`, después del cierre del `describe("computeDiferenciaCajaAcumulada", ...)` (línea 215) y antes de `describe("heatmapFill", ...)`:

```ts
describe("computeDiferenciaCajaPorMes", () => {
  const serieBase: MesDatos[] = [
    { anio: 2026, mes: 7, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },  // jul
    { anio: 2026, mes: 8, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },  // ago
    { anio: 2026, mes: 9, ingresos: 100, egresos: 40, ganancia: 20, disponible: 500 },   // sep — primer arqueo
    { anio: 2026, mes: 10, ingresos: 120, egresos: 50, ganancia: 30, disponible: null }, // oct — sin arqueo propio
    { anio: 2026, mes: 11, ingresos: 110, egresos: 45, ganancia: 25, disponible: 600 },  // nov
  ];
  const primerArqueoSep = { anio: 2026, mes: 9 };

  it("CA-01 — sin ningún arqueo, primerArqueo null, todo el resultado es null", () => {
    const resultado = computeDiferenciaCajaPorMes(serieBase, null);
    expect(resultado).toEqual([null, null, null, null, null]);
  });

  it("CA-02 — julio, agosto y septiembre (mes del primer arqueo inclusive) dan null", () => {
    const resultado = computeDiferenciaCajaPorMes(serieBase, primerArqueoSep);
    expect(resultado[0]).toBeNull();
    expect(resultado[1]).toBeNull();
    expect(resultado[2]).toBeNull();
  });

  it("octubre sin arqueo propio → null", () => {
    const resultado = computeDiferenciaCajaPorMes(serieBase, primerArqueoSep);
    expect(resultado[3]).toBeNull();
  });

  it("noviembre con arqueo propio → SOLO el término contable de noviembre, sin arrastrar el de octubre (decisión spec §1.3, difiere de computeDiferenciaCajaAcumulada que da 20)", () => {
    const resultado = computeDiferenciaCajaPorMes(serieBase, primerArqueoSep);
    // referencia sigue siendo 500 (oct no tenía arqueo, no la pisó). delta = 600 - 500 = 100.
    // término nov = (110-45)-25 = 40. valor = 100 - 40 = 60.
    expect(resultado[4]).toBe(60);
  });

  it("CA-04 — los meses sin cálculo válido son null, nunca 0", () => {
    const resultado = computeDiferenciaCajaPorMes(serieBase, primerArqueoSep);
    expect(resultado[0]).not.toBe(0);
    expect(resultado[0]).toBeNull();
  });

  it("un disponible en 0 se trata como sin arqueo, no como un arqueo real de cero", () => {
    const serie: MesDatos[] = [
      { anio: 2025, mes: 6, ingresos: 100, egresos: 40, ganancia: 20, disponible: 0 },
      { anio: 2025, mes: 7, ingresos: 100, egresos: 40, ganancia: 20, disponible: 0 },
      { anio: 2025, mes: 8, ingresos: 100, egresos: 40, ganancia: 20, disponible: 0 },
      { anio: 2025, mes: 9, ingresos: 100, egresos: 40, ganancia: 20, disponible: 500 }, // primer arqueo real
      { anio: 2025, mes: 10, ingresos: 120, egresos: 50, ganancia: 30, disponible: 0 },  // fantasma
    ];
    const resultado = computeDiferenciaCajaPorMes(serie, { anio: 2025, mes: 9 });
    expect(resultado[3]).toBeNull(); // sep, mes del primer arqueo
    expect(resultado[4]).toBeNull(); // oct con disponible 0 → sin arqueo
  });

  it("un disponible en 0 entre dos arqueos válidos no resetea la referencia", () => {
    const serie: MesDatos[] = [
      { anio: 2025, mes: 9, ingresos: 100, egresos: 40, ganancia: 20, disponible: 500 },
      { anio: 2025, mes: 10, ingresos: 100, egresos: 40, ganancia: 20, disponible: 0 },   // fantasma
      { anio: 2025, mes: 11, ingresos: 110, egresos: 45, ganancia: 25, disponible: 600 },
    ];
    const resultado = computeDiferenciaCajaPorMes(serie, { anio: 2025, mes: 9 });
    expect(resultado[1]).toBeNull();
    // nov: delta contra referencia 500 = 100. término = (110-45)-25 = 40. valor = 100 - 40 = 60.
    expect(resultado[2]).toBe(60);
  });

  it("cross-año — el mes anterior con arqueo puede ser de diciembre del año anterior, y solo se resta el término del mes actual (no el de enero sin arqueo)", () => {
    const serieCrossAnio: MesDatos[] = [
      { anio: 2025, mes: 11, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },
      { anio: 2025, mes: 12, ingresos: 100, egresos: 40, ganancia: 20, disponible: 1000 }, // primer arqueo
      { anio: 2026, mes: 1, ingresos: 120, egresos: 50, ganancia: 30, disponible: null },  // sin arqueo
      { anio: 2026, mes: 2, ingresos: 110, egresos: 45, ganancia: 25, disponible: 900 },
    ];
    const primerArqueoDic2025 = { anio: 2025, mes: 12 };
    const resultado = computeDiferenciaCajaPorMes(serieCrossAnio, primerArqueoDic2025);
    expect(resultado[0]).toBeNull();
    expect(resultado[1]).toBeNull();
    expect(resultado[2]).toBeNull(); // ene 2026, sin arqueo
    // feb 2026: referencia sigue en 1000 (dic), delta = 900 - 1000 = -100.
    // término feb = (110-45)-25 = 40. valor = -100 - 40 = -140 (NO -180, que es lo que da el acumulado).
    expect(resultado[3]).toBe(-140);
  });

  it("gap de varios meses sin arqueo: el mes que reabre resta SOLO su propio término, no la suma del hueco (spec §1.3)", () => {
    const serie: MesDatos[] = [
      { anio: 2025, mes: 1, ingresos: 100, egresos: 40, ganancia: 20, disponible: 1000 }, // primer arqueo
      { anio: 2025, mes: 2, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },
      { anio: 2025, mes: 3, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },
      { anio: 2025, mes: 4, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },
      { anio: 2025, mes: 5, ingresos: 200, egresos: 50, ganancia: 30, disponible: 1300 },
    ];
    const resultado = computeDiferenciaCajaPorMes(serie, { anio: 2025, mes: 1 });
    expect(resultado[1]).toBeNull();
    expect(resultado[2]).toBeNull();
    expect(resultado[3]).toBeNull();
    // may: referencia sigue en 1000 (feb/mar/abr no la tocaron). delta = 1300 - 1000 = 300.
    // término may = (200-50)-30 = 120. valor = 300 - 120 = 180.
    // computeDiferenciaCajaAcumulada da 60 para este mismo caso — la diferencia es la decisión de §1.3.
    expect(resultado[4]).toBe(180);
  });

  it("fixture real de San Justo (PDF Correccion_diferencia_caja_por_mes, sep-2025 → jul-2026) — reproduce exacto la fila \"Por mes\"", () => {
    // Serie construida para producir exactamente los valores "Por mes" del PDF: ingresos=500.000,
    // egresos=0, ganancia=0 todos los meses (término contable constante = 500.000) y `disponible`
    // despejado de la fórmula para que cada delta - término dé el valor esperado del PDF.
    const serie: MesDatos[] = [
      { anio: 2025, mes: 9, ingresos: 0, egresos: 0, ganancia: 0, disponible: 0 },              // sep — primer arqueo
      { anio: 2025, mes: 10, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: -4_571_746 },
      { anio: 2025, mes: 11, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: 1_022_744 },
      { anio: 2025, mes: 12, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: 2_552_609 },
      { anio: 2026, mes: 1, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: 6_017_489 },
      { anio: 2026, mes: 2, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: 6_031_453 },
      { anio: 2026, mes: 3, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: 3_731_502 },
      { anio: 2026, mes: 4, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: 7_409_647 },
      { anio: 2026, mes: 5, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: 10_638_410 },
      { anio: 2026, mes: 6, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: 16_668_455 },
      { anio: 2026, mes: 7, ingresos: 500_000, egresos: 0, ganancia: 0, disponible: 12_571_571 },
    ];
    const primerArqueo = { anio: 2025, mes: 9 };
    const resultado = computeDiferenciaCajaPorMes(serie, primerArqueo);
    expect(resultado[0]).toBeNull();          // sep, mes del primer arqueo
    expect(resultado[1]).toBe(-5_071_746);    // oct
    expect(resultado[2]).toBe(5_094_490);     // nov
    expect(resultado[3]).toBe(1_029_865);     // dic
    expect(resultado[4]).toBe(2_964_880);     // ene
    expect(resultado[5]).toBe(-486_036);      // feb
    expect(resultado[6]).toBe(-2_799_951);    // mar — faltante real de $2,8M (recuadro rojo del PDF)
    expect(resultado[7]).toBe(3_178_145);     // abr
    expect(resultado[8]).toBe(2_728_763);     // may
    expect(resultado[9]).toBe(5_530_045);     // jun
    expect(resultado[10]).toBe(-4_596_884);   // jul — faltante real de $4,6M (recuadro rojo del PDF)

    // Auto-consistencia: la suma de "por mes" debe coincidir con el último valor de
    // computeDiferenciaCajaAcumulada sobre la misma serie (fila "Acumulado" del PDF, Jul26 = 7.571.571).
    const acumulado = computeDiferenciaCajaAcumulada(serie, primerArqueo);
    const sumaPorMes = resultado.reduce((acc, v) => acc + (v ?? 0), 0);
    expect(sumaPorMes).toBe(acumulado[10]);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/dashboard/resultados-calc.test.ts`
Expected: FAIL — `computeDiferenciaCajaPorMes is not a function` (o error de import, según cómo Vitest reporte un símbolo no exportado).

- [ ] **Step 3: Agregar el import en el test file**

En `lib/dashboard/resultados-calc.test.ts`, línea 6, agregar `computeDiferenciaCajaPorMes` al import existente:

```ts
import {
  parseMontoARS,
  montoNoGuardable,
  pctSobreIngresos,
  computeDiferenciaCajaAcumulada,
  computeDiferenciaCajaPorMes,
  type MesDatos,
  heatmapFill,
  heatmapFillZeroAnchored,
  heatmapTextZeroAnchored,
  RESULT_COLORS,
} from "./resultados-calc";
```

- [ ] **Step 4: Implementar `computeDiferenciaCajaPorMes`**

En `lib/dashboard/resultados-calc.ts`, agregar después del cierre de `computeDiferenciaCajaAcumulada` (después de la línea 81):

```ts
// Diferencia de caja POR MES (spec 2026-09-16, reemplaza el acumulado como valor principal).
// Cada mes con arqueo es independiente: valor = (arqueo - referencia) - término contable DEL MES
// ACTUAL únicamente. `referencia` (último arqueo real conocido) se arrastra igual que en
// computeDiferenciaCajaAcumulada — mismo criterio de "$0/null = sin dato" (spec 2026-08-31).
//
// Decisión confirmada 2026-09-16: en un hueco de 2+ meses sin arqueo, el término contable que se
// resta al cerrar el hueco es SOLO el del mes que cierra, no la suma de los meses ocultos — lectura
// literal de la fórmula del PDF. Esto difiere del modelo acumulado (que sí arrastra el término
// contable de los meses ocultos, ver computeDiferenciaCajaAcumulada arriba); es una decisión de
// negocio, no un bug — ver spec 2026-09-16-diferencia-caja-por-mes-design.md §1.3.
export function computeDiferenciaCajaPorMes(
  serie: MesDatos[],
  primerArqueo: { anio: number; mes: number } | null,
): (number | null)[] {
  const resultado: (number | null)[] = serie.map(() => null);
  if (primerArqueo == null) return resultado;

  const i0 = serie.findIndex((m) => m.anio === primerArqueo.anio && m.mes === primerArqueo.mes);
  if (i0 === -1) return resultado;

  let referencia = serie[i0].disponible ?? 0;
  for (let i = i0 + 1; i < serie.length; i++) {
    const m = serie[i];
    const arqueo = m.disponible !== 0 ? m.disponible : null;
    if (arqueo == null) continue; // sin arqueo este mes: referencia y resultado[i] no se tocan
    const deltaDisponible = arqueo - referencia;
    referencia = arqueo;
    resultado[i] = deltaDisponible - ((m.ingresos - m.egresos) - m.ganancia);
  }
  return resultado;
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/dashboard/resultados-calc.test.ts`
Expected: PASS — todos los tests, incluidos los preexistentes de `computeDiferenciaCajaAcumulada` (no deben romperse).

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/resultados-calc.ts lib/dashboard/resultados-calc.test.ts
git commit -m "feat(dashboard): agrega computeDiferenciaCajaPorMes (cálculo por mes independiente)"
```

---

### Task 2: `buildDiferenciaCajaSerie` devuelve `{ valor, acumulado }` por mes

**Files:**
- Modify: `lib/dashboard/diferencia-caja-serie.ts`
- Test: `lib/dashboard/diferencia-caja-serie.test.ts` (reescritura completa al nuevo shape)

**Interfaces:**
- Consumes: `computeDiferenciaCajaPorMes` y `computeDiferenciaCajaAcumulada` (Task 1, `lib/dashboard/resultados-calc.ts`), `MONTH_IDXS` (`lib/dashboard/constants.ts`).
- Produces: `export interface DiferenciaCajaMes { valor: number | null; acumulado: number | null }` y `buildDiferenciaCajaSerie(input): Record<number, DiferenciaCajaMes>` — Task 3 (route.ts) y Task 4 (hook) consumen este tipo y esta firma.

- [ ] **Step 1: Reescribir el test file al nuevo shape (tests que fallan)**

Reemplazar el contenido completo de `lib/dashboard/diferencia-caja-serie.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDiferenciaCajaSerie, type TotalesAnio } from "./diferencia-caja-serie";

// Helper: arma un TotalesAnio con los mismos números en todos los meses salvo overrides.
function totales(over: Partial<{
  ingresos: Record<number, number>;
  egresos: Record<number, number>;
  ganancia: Record<number, number>;
  disponible: Record<number, number | null>;
}> = {}): TotalesAnio {
  return {
    ingresosPorMes: over.ingresos ?? {},
    egresosPorMes: over.egresos ?? {},
    gananciaPorMes: over.ganancia ?? {},
    disponiblePorMes: over.disponible ?? {},
  };
}

describe("buildDiferenciaCajaSerie", () => {
  it("sin primer arqueo → los 12 meses en { valor: null, acumulado: null }", () => {
    const out = buildDiferenciaCajaSerie({ year: 2025, primerArqueo: null, totalesPorAnio: {} });
    expect(Object.keys(out)).toHaveLength(12);
    expect(Object.values(out).every((v) => v.valor === null && v.acumulado === null)).toBe(true);
  });

  it("primer arqueo en un año posterior al pedido → los 12 meses vacíos", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2024,
      primerArqueo: { anio: 2025, mes: 3 },
      totalesPorAnio: {},
    });
    expect(Object.values(out).every((v) => v.valor === null && v.acumulado === null)).toBe(true);
  });

  it("un solo año: meses <= primer arqueo vacíos, mes con arqueo posterior con valor y acumulado", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2025,
      primerArqueo: { anio: 2025, mes: 3 },
      totalesPorAnio: {
        2025: totales({
          ingresos: { 3: 100, 4: 120 },
          egresos: { 3: 40, 4: 50 },
          ganancia: { 3: 20, 4: 30 },
          disponible: { 3: 500, 4: 600 },
        }),
      },
    });
    expect(out[1].valor).toBeNull();
    expect(out[2].valor).toBeNull();
    expect(out[3].valor).toBeNull(); // mes del primer arqueo
    // abr: delta = 600 - 500 = 100; contable = (120-50)-30 = 40; valor = 100 - 40 = 60
    expect(out[4].valor).toBe(60);
    expect(out[4].acumulado).toBe(60); // sin huecos previos, valor y acumulado coinciden
    expect(out[5].valor).toBeNull(); // sin datos → sin arqueo → null
  });

  it("cross-año: primer arqueo en 2025, se pide 2026 → recorta al año pedido con el offset correcto", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2026,
      primerArqueo: { anio: 2025, mes: 12 },
      totalesPorAnio: {
        2025: totales({ disponible: { 12: 1000 } }),
        2026: totales({
          ingresos: { 1: 120, 2: 110 },
          egresos: { 1: 50, 2: 45 },
          ganancia: { 1: 30, 2: 25 },
          disponible: { 2: 900 },
        }),
      },
    });
    // ene 2026: sin arqueo propio → null
    expect(out[1].valor).toBeNull();
    // feb 2026: referencia sigue en 1000 (ene no la tocó). delta = 900 - 1000 = -100.
    // término feb = (110-45)-25 = 40. valor = -100 - 40 = -140.
    expect(out[2].valor).toBe(-140);
    // acumulado (computeDiferenciaCajaAcumulada, sin cambios): acc ene = -40, acc feb = -180.
    expect(out[2].acumulado).toBe(-180);
  });

  it("un 0 de valor legítimo en un mes con arqueo se muestra como 0, no como null", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2025,
      primerArqueo: { anio: 2025, mes: 1 },
      totalesPorAnio: {
        2025: totales({ disponible: { 1: 1000, 2: 1000 } }),
      },
    });
    expect(out[1].valor).toBeNull(); // ene, mes del primer arqueo
    expect(out[2].valor).toBe(0);    // feb: valor exactamente 0, NO null
    expect(out[2].acumulado).toBe(0);
  });

  it("año faltante en totalesPorAnio se trata como año vacío (no rompe)", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2026,
      primerArqueo: { anio: 2025, mes: 1 },
      totalesPorAnio: { 2025: totales({ disponible: { 1: 1000 } }) }, // falta 2026
    });
    expect(Object.keys(out)).toHaveLength(12);
    expect(out[1].valor).toBeNull();
  });

  it("hueco multi-mes: el valor por mes diverge del acumulado, ambos se calculan sobre la misma serie", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2025,
      primerArqueo: { anio: 2025, mes: 1 },
      totalesPorAnio: {
        2025: totales({
          ingresos: { 1: 100, 2: 100, 3: 100, 4: 100, 5: 200 },
          egresos: { 1: 40, 2: 40, 3: 40, 4: 40, 5: 50 },
          ganancia: { 1: 20, 2: 20, 3: 20, 4: 20, 5: 30 },
          disponible: { 1: 1000, 5: 1300 }, // feb/mar/abr sin arqueo
        }),
      },
    });
    expect(out[2].valor).toBeNull();
    expect(out[3].valor).toBeNull();
    expect(out[4].valor).toBeNull();
    // may: referencia sigue en 1000. delta = 1300-1000=300. término = (200-50)-30=120. valor=180.
    expect(out[5].valor).toBe(180);
    // acumulado (sin cambios): arrastra el término de feb/mar/abr → 60 (ver resultados-calc.test.ts).
    expect(out[5].acumulado).toBe(60);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/dashboard/diferencia-caja-serie.test.ts`
Expected: FAIL — las aserciones `.valor`/`.acumulado` fallan contra el shape viejo (`number | null` plano), o error de tipos si se corre `tsc` primero.

- [ ] **Step 3: Reescribir `buildDiferenciaCajaSerie`**

Reemplazar el contenido completo de `lib/dashboard/diferencia-caja-serie.ts`:

```ts
// Arma la serie mensual continua para Diferencia de caja y corre los dos cálculos derivados de ella:
// el valor "por mes" (principal, spec 2026-09-16) y el acumulado desde el primer arqueo (dato
// secundario de tooltip). Puro: sin fetch, sin Prisma, sin React — testeable con fixtures. La
// orquestación de datos (primer arqueo + sumas SQL) vive en app/api/dashboard/diferencia-caja/route.ts.

import { MONTH_IDXS } from "@/lib/dashboard/constants";
import {
  computeDiferenciaCajaAcumulada,
  computeDiferenciaCajaPorMes,
  type MesDatos,
} from "@/lib/dashboard/resultados-calc";

export interface TotalesAnio {
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  gananciaPorMes: Record<number, number>;
  disponiblePorMes: Record<number, number | null>;
}

export interface DiferenciaCajaMes {
  valor: number | null;      // "por mes" — lo que se muestra en la celda (spec 2026-09-16)
  acumulado: number | null;  // acumulado desde el primer arqueo — dato secundario de tooltip
}

// LÍMITE CONOCIDO (I-3, ver spec 2026-09-09 §1.5 y el fix wave del 24-ago-2026): los agregados
// de compras/ventas arman mapas dispersos — una clave de mes existe solo si hubo filas que
// matchearon. El `?? 0` no distingue "el mes tuvo $0 de verdad" de "no hay dato para este mes"
// (p. ej. import pendiente). Decisión pospuesta explícitamente (2026-09-09), documentada no resuelta.
function toSerieDeUnAnio(anio: number, totals: TotalesAnio): MesDatos[] {
  return MONTH_IDXS.map((mes) => ({
    anio,
    mes,
    ingresos: totals.ingresosPorMes[mes] ?? 0,
    egresos: totals.egresosPorMes[mes] ?? 0,
    ganancia: totals.gananciaPorMes[mes] ?? 0,
    disponible: totals.disponiblePorMes[mes] ?? null,
  }));
}

const ANIO_VACIO: TotalesAnio = {
  ingresosPorMes: {},
  egresosPorMes: {},
  gananciaPorMes: {},
  disponiblePorMes: {},
};

const MES_VACIO: DiferenciaCajaMes = { valor: null, acumulado: null };

export function buildDiferenciaCajaSerie(input: {
  year: number;
  primerArqueo: { anio: number; mes: number } | null;
  totalesPorAnio: Record<number, TotalesAnio>;
}): Record<number, DiferenciaCajaMes> {
  const { year, primerArqueo, totalesPorAnio } = input;

  const vacio: Record<number, DiferenciaCajaMes> = {};
  for (const mes of MONTH_IDXS) vacio[mes] = MES_VACIO;
  if (primerArqueo == null || primerArqueo.anio > year) return vacio;

  const anios: number[] = [];
  for (let a = primerArqueo.anio; a <= year; a++) anios.push(a);

  const serie: MesDatos[] = anios.flatMap((anio) =>
    toSerieDeUnAnio(anio, totalesPorAnio[anio] ?? ANIO_VACIO),
  );
  const porMes = computeDiferenciaCajaPorMes(serie, primerArqueo);
  const acumulado = computeDiferenciaCajaAcumulada(serie, primerArqueo);

  const offset = (year - primerArqueo.anio) * 12;
  const out: Record<number, DiferenciaCajaMes> = {};
  for (const mes of MONTH_IDXS) {
    const i = offset + (mes - 1);
    out[mes] = { valor: porMes[i] ?? null, acumulado: acumulado[i] ?? null };
  }
  return out;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/dashboard/diferencia-caja-serie.test.ts`
Expected: PASS — todos los tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/diferencia-caja-serie.ts lib/dashboard/diferencia-caja-serie.test.ts
git commit -m "feat(dashboard): buildDiferenciaCajaSerie devuelve valor por mes + acumulado"
```

---

### Task 3: Propagar el shape nuevo por el endpoint y el hook

**Files:**
- Modify: `app/api/dashboard/diferencia-caja/route.ts`
- Modify: `hooks/use-diferencia-caja.ts`

**Interfaces:**
- Consumes: `DiferenciaCajaMes`, `buildDiferenciaCajaSerie` (Task 2, `lib/dashboard/diferencia-caja-serie.ts`).
- Produces: `useDiferenciaCaja({ year, localId, pdvId })` devuelve `{ diferenciaPorMes: Record<number, DiferenciaCajaMes>, isLoading: boolean, isError: boolean }` — Task 4 (`caja-rows.tsx`) consume este shape.

Sin test unitario propio (mismo criterio que specs anteriores para este endpoint y este hook — no hay infra de test de rutas Next.js ni de hooks con TanStack Query en el repo). La verificación de este task es el build + typecheck, y queda cubierta end-to-end por la verificación manual del Task 5.

- [ ] **Step 1: Actualizar `diferenciaVacia()` y el import en `route.ts`**

En `app/api/dashboard/diferencia-caja/route.ts`, línea 11, cambiar el import:

```ts
import { buildDiferenciaCajaSerie, type TotalesAnio, type DiferenciaCajaMes } from "@/lib/dashboard/diferencia-caja-serie";
```

Y reemplazar la función `diferenciaVacia` (líneas 25-29):

```ts
// Respuesta "sin datos": los 12 meses vacíos. Se usa tanto para el año fuera de rango
// como para el caso sin ningún arqueo.
function diferenciaVacia(): Record<number, DiferenciaCajaMes> {
  const vacio: Record<number, DiferenciaCajaMes> = {};
  for (const mes of MONTH_IDXS) vacio[mes] = { valor: null, acumulado: null };
  return vacio;
}
```

- [ ] **Step 2: Verificar que el resto de `route.ts` sigue tipando sin cambios**

El resto del archivo (guarda de fan-out, agregados SQL, `buildDiferenciaCajaSerie({ year, primerArqueo, totalesPorAnio })`, `NextResponse.json({ diferenciaPorMes })`) no necesita cambios de código — `diferenciaPorMes` ahora es `Record<number, DiferenciaCajaMes>` porque `buildDiferenciaCajaSerie` ya devuelve ese shape (Task 2).

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `app/api/dashboard/diferencia-caja/route.ts`.

- [ ] **Step 3: Actualizar `use-diferencia-caja.ts` al nuevo shape**

Reemplazar el contenido completo de `hooks/use-diferencia-caja.ts`:

```ts
"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { buildDiferenciaCajaUrl } from "@/lib/dashboard/params";
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import type { DiferenciaCajaMes } from "@/lib/dashboard/diferencia-caja-serie";

interface Params {
  year: number;
  localId?: number;
  pdvId?: number;
}

interface DiferenciaCajaResponse {
  diferenciaPorMes: Record<number, DiferenciaCajaMes>;
}

const MES_VACIO: DiferenciaCajaMes = { valor: null, acumulado: null };

// Diferencia de caja por mes + acumulado como dato secundario (ver spec 2026-09-16 y
// 2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico). Toda la orquestación —primer
// arqueo, agregados por mes del rango de años, ambos cálculos— vive server-side en
// GET /api/dashboard/diferencia-caja; acá solo se consume en un request. Un mes sin arqueo
// cargado viene como { valor: null, acumulado: null } (celda "—").
export function useDiferenciaCaja({ year, localId, pdvId }: Params) {
  const { data, isLoading, isError } = useFetchQuery<DiferenciaCajaResponse>(
    ["diferencia-caja", year, localId, pdvId],
    buildDiferenciaCajaUrl(year, localId, pdvId),
    { staleTime: 30_000 },
  );

  const diferenciaPorMes: Record<number, DiferenciaCajaMes> = {};
  for (const mes of MONTH_IDXS) diferenciaPorMes[mes] = data?.diferenciaPorMes[mes] ?? MES_VACIO;

  return { diferenciaPorMes, isLoading, isError };
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en `hooks/use-diferencia-caja.ts` ni en `app/api/dashboard/diferencia-caja/route.ts`. `components/dashboard/caja-rows.tsx` SÍ va a marcar errores acá (todavía consume el shape viejo) — se resuelven en Task 4, no es una regresión de este task.

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard/diferencia-caja/route.ts hooks/use-diferencia-caja.ts
git commit -m "refactor(dashboard): propaga el shape valor+acumulado por el endpoint y el hook"
```

---

### Task 4: UI — `caja-rows.tsx` consume el shape nuevo

**Files:**
- Modify: `components/dashboard/caja-rows.tsx`

**Interfaces:**
- Consumes: `useDiferenciaCaja` devolviendo `{ diferenciaPorMes: Record<number, DiferenciaCajaMes>, isLoading, isError }` (Task 3).

Sin test unitario propio (no hay infra de test de componentes en el repo, mismo criterio que specs anteriores). Verificación: typecheck + build + lint + revisión visual manual (no hay browser disponible en esta sesión — dejar explícito en el reporte final, no afirmar "verificado visualmente" sin haberlo hecho).

- [ ] **Step 1: Actualizar la celda mensual de Diferencia de caja**

En `components/dashboard/caja-rows.tsx`, reemplazar el bloque de renderizado de celdas mensuales (líneas 223-238):

```tsx
        {months.map((mes) => {
          const { valor: diferencia, acumulado } = diferenciaPorMes[mes];
          const noData = !diferenciaLoading && diferencia == null;
          const title = diferenciaError
            ? "Error al cargar Diferencia de caja"
            : diferencia != null
              ? `Acumulado desde el primer arqueo: ${fmtARS(acumulado)}`
              : undefined;
          return (
            <ValueCell
              key={mes}
              base={VALUE_TD}
              className={cn("bg-muted", cardCellClasses("last", "mid"))}
              title={title}
              loading={diferenciaLoading}
              text={diferencia == null ? "—" : fmtARS(diferencia)}
              negative={diferencia != null && diferencia < 0}
              gray={noData}
            />
          );
        })}
```

- [ ] **Step 2: Actualizar el cálculo del total anual**

Reemplazar el bloque IIFE del total (líneas 239-259):

```tsx
        {(() => {
          // Total anual = suma de los meses visibles (spec 2026-09-16 §1.4) — cada mes ya es
          // independiente, no tiene sentido mostrar "el último acumulado" como antes.
          let total: number | null = null;
          for (const mes of months) {
            const v = diferenciaPorMes[mes].valor;
            if (v != null) total = (total ?? 0) + v;
          }
          const noData = !diferenciaLoading && total == null;
          return (
            <ValueCell
              base={TOTAL_TD}
              className={cn("bg-muted font-bold", cardCellClasses("last", "mid"))}
              title="Suma de los meses con arqueo cargado"
              loading={diferenciaLoading}
              text={total == null ? "—" : fmtARS(total)}
              negative={total != null && total < 0}
              gray={noData}
            />
          );
        })()}
```

- [ ] **Step 3: Reescribir el popover de la fórmula**

En el mismo archivo, reemplazar el `title` de `StickyCardCell` (línea 186) y el contenido del `PopoverContent` (líneas 196-204):

```tsx
        <StickyCardCell position="last" bg="bg-muted" className="px-4 py-1.5 whitespace-nowrap font-bold" title="(Arqueo del mes − Arqueo del mes anterior) − (Resultado OP − Ganancia), por mes">
          <span className="inline-flex items-center gap-1">
            Diferencia de caja
            <Popover>
              <PopoverTrigger
                className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                aria-label="Ver fórmula de Diferencia de caja"
              >
                <Info className="w-3.5 h-3.5" />
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4 text-xs leading-relaxed text-muted-foreground font-normal">
                <p className="text-[13px] font-semibold text-foreground leading-snug">
                  Diferencia de caja (mes) = (Arqueo del mes − Arqueo del mes anterior) − (Resultado OP − Ganancia)
                </p>
                <p className="mt-1.5">
                  Cada mes es independiente. "Mes anterior" es el último con Disponible en caja
                  cargado (compara contra diciembre del año anterior si hace falta). Solo los meses
                  con Disponible en caja cargado muestran un valor; el resto queda en "—". Pasá el
                  mouse sobre un mes para ver el acumulado desde el primer arqueo.
                </p>
```

(El bloque de la leyenda de colores rojo/verde/gris que sigue, líneas 205-218, no cambia.)

- [ ] **Step 4: Typecheck, lint y build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sin errores. Si `npm run build` falla por algo no relacionado a este cambio, investigar antes de continuar (no ignorar).

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/caja-rows.tsx
git commit -m "feat(dashboard): Diferencia de caja muestra el valor por mes, acumulado en tooltip"
```

---

### Task 5: Verificación final y cierre

**Files:** ninguno (solo comandos de verificación).

- [ ] **Step 1: Correr toda la suite de tests**

Run: `npx vitest run`
Expected: PASS — todos los tests, incluidos los de `resultados-calc.test.ts` y `diferencia-caja-serie.test.ts` de las Tasks 1-2, y ningún test preexistente roto.

- [ ] **Step 2: Lint y build completos**

Run: `npm run lint && npm run build`
Expected: sin errores ni warnings nuevos.

- [ ] **Step 3: Confirmar en el reporte de cierre qué quedó sin verificar**

Este plan no incluye verificación visual en browser (no disponible en esta sesión) ni verificación contra la base de datos real de producción — el cambio es de cálculo puro, cubierto por el fixture real de San Justo del PDF como test determinístico (Task 1, último test). El reporte de cierre de esta tarea debe decir explícitamente: "cubierto por tests unitarios + build/lint; falta la pasada visual del usuario contra el Dashboard real antes de considerarlo cerrado del todo" — igual que el criterio de cierre de la spec (§4, "Verificación de cierre").

- [ ] **Step 4: Actualizar la memoria del proyecto**

Actualizar `project_fix_diferencia_caja_spec.md` (memoria) agregando una sección "Actualización [fecha] — mecánica por-mes implementada y verificada por tests" con: qué se implementó, que `computeDiferenciaCajaAcumulada` no cambió, la decisión de huecos multi-mes (§1.3 de la spec) y que falta la pasada visual del usuario. Actualizar también la línea correspondiente en `MEMORY.md`.

No hace falta commit de git para este step (la memoria vive fuera del repo).

---

## Self-Review

**Spec coverage:**
- §1.2 (fórmula nueva) → Task 1.
- §1.3 (decisión de huecos multi-mes) → Task 1, tests dedicados + comentario en el código.
- §1.4 (total anual = suma, acumulado en tooltip por celda) → Task 4.
- §3.1 (`computeDiferenciaCajaPorMes`, `computeDiferenciaCajaAcumulada` sin cambios) → Task 1.
- §3.2 (`DiferenciaCajaMes`, `buildDiferenciaCajaSerie`) → Task 2.
- §3.3 (`route.ts`) y §3.4 (`use-diferencia-caja.ts`) → Task 3.
- §3.5 (UI: celda, total, popover) → Task 4.
- §4 (testing: fixture de San Justo, caso de hueco, shape nuevo) → Task 1 y Task 2.
- §5 (riesgos: I-3 sigue viva, sin migración) → documentado en Global Constraints y en los comentarios de código de Task 1/2, ningún task la resuelve (está fuera de alcance por la spec).

Sin gaps encontrados.

**Placeholder scan:** sin "TBD"/"TODO"/"handle edge cases" genéricos — todos los pasos tienen código concreto o comandos exactos.

**Type consistency:** `DiferenciaCajaMes` se define una sola vez (Task 2, `diferencia-caja-serie.ts`) y se importa igual en Task 3 (`route.ts`, `use-diferencia-caja.ts`) y se consume por destructuring en Task 4 (no se re-declara). `computeDiferenciaCajaPorMes(serie: MesDatos[], primerArqueo)` tiene la misma firma en Task 1 (definición) y Task 2 (uso). Nombres de campos (`valor`, `acumulado`) consistentes en las tres tasks que los tocan.
