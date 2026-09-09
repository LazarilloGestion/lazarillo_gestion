# Diferencia de caja — celda vacía sin arqueo + endpoint único — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La fila "Diferencia de caja" del Dashboard de Resultados muestra "—" en todo mes sin arqueo cargado (la continuidad del acumulado se preserva por detrás), y sus datos llegan en un solo request en vez de un fan-out de 8+ endpoints.

**Architecture:** Un endpoint nuevo `GET /api/dashboard/diferencia-caja` hace toda la agregación server-side (primer arqueo + 3 sumas SQL por mes + arqueos) y corre el cálculo puro. `computeDiferenciaCajaAcumulada` cambia una línea: solo asigna el acumulado a la celda si ese mes tiene arqueo real. El hook `useDiferenciaCaja` pasa a ser un wrapper fino de `useFetchQuery`. La UI cambia `…` por `<Spinner>` en toda la sección Caja.

**Tech Stack:** Next.js 16 App Router (route handlers), Prisma 7 (`$queryRaw` + `adapter-pg`), Zod (`safeParse` en query params), TanStack Query (`useFetchQuery`), Vitest (lógica pura), Tailwind + lucide-react (`Spinner`).

**Spec:** `docs/superpowers/specs/2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico.md`

## Global Constraints

- Toda query a la base pasa por Prisma (`$queryRaw` con `Prisma.sql`/`Prisma.join`, nunca `pg` directo ni interpolación de strings).
- Route handlers nuevos que tocan datos de negocio: `requireAuth()` al inicio, sin dependencia de RLS. Autorización 100% de aplicación.
- Validar todo dato externo (query params) con `zod` `safeParse` antes de usarlo.
- Manejo de errores explícito — `try/catch` con `console.error("[GET /api/dashboard/...]", err)` y `500`. Prohibido `catch {}` vacío.
- TypeScript estricto, sin `any` sin comentario que lo justifique.
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Correr `npm run lint` y `npm run build` después de cambios relevantes; no cerrar una tarea que rompe tests existentes.
- No agregar dependencias nuevas.
- El endpoint nuevo es de solo lectura — no toca schema, no hay migración, no modifica datos de compras/ventas ya importados.
- I-3 (mapas dispersos: `?? 0` no distingue "$0 real" de "sin dato") queda **fuera de alcance**, documentada con comentario en `diferencia-caja-serie.ts`.

---

## File Structure

**Crear:**
- `lib/dashboard/primer-arqueo.ts` — `findPrimerArqueo(filtro)`: la query del arqueo más viejo, compartible. Reemplaza la lógica inline de la ruta standalone que se borra.
- `lib/dashboard/diferencia-caja-serie.ts` — `buildDiferenciaCajaSerie(input)`: función pura que arma `MesDatos[]` del rango de años, llama `computeDiferenciaCajaAcumulada` y recorta al año pedido. Testeable sin DB. Hospeda el comentario de I-3.
- `lib/dashboard/diferencia-caja-serie.test.ts` — tests de `buildDiferenciaCajaSerie`.
- `app/api/dashboard/diferencia-caja/route.ts` — el endpoint nuevo: auth + Zod + `findPrimerArqueo` + 3 sumas SQL por año + arqueos + `buildDiferenciaCajaSerie`.

**Modificar:**
- `lib/dashboard/resultados-calc.ts` — `computeDiferenciaCajaAcumulada`: `resultado[i] = arqueo != null ? acc : null` + comentario actualizado.
- `lib/dashboard/resultados-calc.test.ts` — ajustar las expectativas de los meses sin arqueo (pasan de un número a `null`); test nuevo de gap multi-mes.
- `lib/dashboard/params.ts` — agregar `buildDiferenciaCajaUrl`, borrar `buildPrimerArqueoUrl`.
- `hooks/use-diferencia-caja.ts` — reescrito como wrapper de `useFetchQuery` (~135 → ~22 líneas).
- `components/dashboard/caja-rows.tsx` — `ValueCell` gana prop `loading`; `<Spinner>` en las 4 celdas de la sección Caja; textos del popover; invalidación de query key.

**Borrar:**
- `app/api/dashboard/flujo-caja/primer-arqueo/route.ts` — sin consumidores tras el Task 5.

---

## Task 1: `computeDiferenciaCajaAcumulada` — celda vacía sin arqueo

**Files:**
- Modify: `lib/dashboard/resultados-calc.ts:39-72`
- Test: `lib/dashboard/resultados-calc.test.ts:85-201`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `computeDiferenciaCajaAcumulada(serie: MesDatos[], primerArqueo: { anio: number; mes: number } | null): (number | null)[]` — firma **sin cambios**; cambia el comportamiento: un índice de mes sin arqueo real (`disponible` `null` o `0`) devuelve `null` en vez del acumulado corriente. `MesDatos` sin cambios.

- [ ] **Step 1: Ajustar los tests existentes que esperan un número en meses sin arqueo**

En `lib/dashboard/resultados-calc.test.ts`, reemplazar el bloque del test `"CA-02 — octubre (mes siguiente al primer arqueo) da el primer valor calculado"` (actual líneas ~108-114) por:

```ts
  it("octubre sin arqueo propio → null (no se muestra el acumulado en meses sin arqueo)", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    // oct tiene disponible: null → celda vacía, aunque el acumulador ya corre por detrás.
    expect(resultado[3]).toBeNull();
  });
```

Reemplazar el bloque del test `"CA-03 — octubre sin disponible propio no corta la cadena: noviembre sigue acumulando sobre octubre"` (actual líneas ~116-121) por:

```ts
  it("noviembre con arqueo propio → el acumulado arrastra el término contable de octubre (continuidad de CA-03 intacta)", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    // oct: sin arqueo, no se muestra, pero acc += 0 - ((120-50)-30) = -40
    // nov: arqueo 600, delta = 600 - 500 = 100; acc += 100 - ((110-45)-25) = +60 → acc = 20
    expect(resultado[4]).toBe(20);
  });
```

En el test `"caso cross-año — primer arqueo en el año anterior..."` (actual líneas ~129-146), cambiar la aserción de `ene 2026` (índice 2, `disponible: null`):

```ts
    // ene 2026: disponible null → celda vacía (el acumulador sigue por detrás)
    expect(resultado[2]).toBeNull();
    // feb 2026: disponible 900 → delta = 900 - 1000 = -100, referencia pasa a 900
    // contribución = -100 - ((110-45)-25) = -140; acumulado = -40 + (-140) = -180
    expect(resultado[3]).toBe(-180);
```

En el test `"un disponible en 0 se trata como sin arqueo, no como un arqueo real de cero"` (actual líneas ~169-186), cambiar la aserción final de `oct` (índice 4, `disponible: 0`):

```ts
    // oct con disponible 0 → tratado como sin arqueo (0 ≡ null): celda vacía.
    expect(resultado[4]).toBeNull();
```

En el test `"un disponible en 0 entre dos arqueos válidos no resetea la referencia"` (actual líneas ~188-200), cambiar la aserción de `oct` (índice 1, `disponible: 0`), dejando la de `nov` como está:

```ts
    // oct: disponible 0 → sin arqueo, celda vacía. Por detrás: acc = 0 - ((100-40)-20) = -40
    expect(resultado[1]).toBeNull();
    // nov: disponible 600, delta contra referencia 500 = 100. contribución = 100 - ((110-45)-25) = 60. acc = -40 + 60 = 20
    expect(resultado[2]).toBe(20);
```

- [ ] **Step 2: Agregar el test de gap multi-mes**

Agregar dentro de `describe("computeDiferenciaCajaAcumulada", ...)`:

```ts
  it("gap de varios meses sin arqueo: todos null, el arqueo posterior reconcilia contra el último arqueo real", () => {
    const serie: MesDatos[] = [
      { anio: 2025, mes: 1, ingresos: 100, egresos: 40, ganancia: 20, disponible: 1000 }, // ene — primer arqueo
      { anio: 2025, mes: 2, ingresos: 100, egresos: 40, ganancia: 20, disponible: null }, // feb — sin arqueo
      { anio: 2025, mes: 3, ingresos: 100, egresos: 40, ganancia: 20, disponible: null }, // mar — sin arqueo
      { anio: 2025, mes: 4, ingresos: 100, egresos: 40, ganancia: 20, disponible: null }, // abr — sin arqueo
      { anio: 2025, mes: 5, ingresos: 200, egresos: 50, ganancia: 30, disponible: 1300 }, // may — arqueo
    ];
    const resultado = computeDiferenciaCajaAcumulada(serie, { anio: 2025, mes: 1 });
    expect(resultado[0]).toBeNull(); // ene, mes del primer arqueo
    expect(resultado[1]).toBeNull(); // feb
    expect(resultado[2]).toBeNull(); // mar
    expect(resultado[3]).toBeNull(); // abr
    // feb/mar/abr: acc += 0 - ((100-40)-20) = -40 cada uno → -120
    // may: delta = 1300 - 1000 = 300; acc += 300 - ((200-50)-30) = 300 - 120 = +180 → -120 + 180 = 60
    expect(resultado[4]).toBe(60);
  });
```

- [ ] **Step 3: Correr los tests y verlos fallar**

Run: `npx vitest run lib/dashboard/resultados-calc.test.ts`
Expected: FAIL — los tests ajustados y el nuevo fallan porque la implementación todavía asigna `acc` en meses sin arqueo (p. ej. `resultado[3]` da `-40`, no `null`).

- [ ] **Step 4: Cambiar la implementación**

En `lib/dashboard/resultados-calc.ts`, en el `for` de `computeDiferenciaCajaAcumulada` (actual línea ~69), cambiar:

```ts
    acc += deltaDisponible - ((m.ingresos - m.egresos) - m.ganancia);
    resultado[i] = acc;
```

por:

```ts
    acc += deltaDisponible - ((m.ingresos - m.egresos) - m.ganancia);
    // Solo se MUESTRA el acumulado en meses con arqueo real cargado (ver spec 2026-09-09).
    // `acc` y `referencia` ya se actualizaron arriba: la continuidad no se corta.
    resultado[i] = arqueo != null ? acc : null;
```

- [ ] **Step 5: Reemplazar el comentario del bloque de la función**

Reemplazar el comentario actual sobre `computeDiferenciaCajaAcumulada` (actual líneas ~39-48) por:

```ts
// Diferencia de caja acumulada. El acumulador arranca en el mes siguiente al primer arqueo
// cargado (`primerArqueo`) y suma, mes a mes, la VARIACIÓN del Disponible en caja respecto del
// último arqueo conocido, menos el término contable del mes ((ingresos - egresos) - ganancia).
// El Disponible es un stock/balance, no un flujo: sumar el saldo crudo reproduce el runaway del
// 13-ago (ver fix del 24-ago-2026), por eso se acumula la variación. `referencia` arrastra el
// último Disponible conocido a través de los meses sin arqueo propio. Un Disponible null o 0 se
// trata como "sin arqueo ese mes" (ver spec 2026-08-31): no aporta variación ni pisa la referencia.
//
// DISPLAY (cambio 2026-09-09, ver spec 2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico):
// una celda solo muestra un valor si ESE mes tiene un arqueo real cargado. Un mes sin arqueo
// devuelve null aunque el acumulador ya tenga un valor corriente — revierte la parte de DISPLAY
// de CA-03 del spec del 24-ago (que mostraba el acumulado en todos los meses posteriores al primer
// arqueo). La CONTINUIDAD de CA-03 se preserva: un arqueo posterior reconcilia contra el último
// arqueo real, arrastrando el término contable de los meses intermedios.
//
// Antes o en el mes del primer arqueo, y si no hay ningún arqueo cargado, el resultado es null
// (nunca 0 — ver Fix_Diferencia_Caja.pdf sección 5.1/CA-04).
```

- [ ] **Step 6: Correr los tests y verlos pasar**

Run: `npx vitest run lib/dashboard/resultados-calc.test.ts`
Expected: PASS — todos los `describe` del archivo (incluye `parseMontoARS`, `montoNoGuardable`, `heatmap*`, que no se tocaron).

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 8: Commit**

```bash
git add lib/dashboard/resultados-calc.ts lib/dashboard/resultados-calc.test.ts
git commit -m "fix(dashboard): diferencia de caja no muestra acumulado en meses sin arqueo

Un mes sin arqueo real cargado devuelve null en vez del acumulado
corriente. El acumulador sigue corriendo por detrás (continuidad de
CA-03 intacta): un arqueo posterior reconcilia contra el anterior.
Revierte la parte de display de CA-03 del spec del 24-ago.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Helper puro `buildDiferenciaCajaSerie`

**Files:**
- Create: `lib/dashboard/diferencia-caja-serie.ts`
- Test: `lib/dashboard/diferencia-caja-serie.test.ts`

**Interfaces:**
- Consumes: `computeDiferenciaCajaAcumulada`, `type MesDatos` de `lib/dashboard/resultados-calc.ts` (Task 1); `MONTH_IDXS` de `lib/dashboard/constants.ts`.
- Produces:
  - `interface TotalesAnio { ingresosPorMes: Record<number, number>; egresosPorMes: Record<number, number>; gananciaPorMes: Record<number, number>; disponiblePorMes: Record<number, number | null>; }`
  - `buildDiferenciaCajaSerie(input: { year: number; primerArqueo: { anio: number; mes: number } | null; totalesPorAnio: Record<number, TotalesAnio> }): Record<number, number | null>` — devuelve las 12 claves (1..12) del `year` pedido; `null` en cada mes sin cálculo válido.

- [ ] **Step 1: Escribir los tests**

Crear `lib/dashboard/diferencia-caja-serie.test.ts`:

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
  it("sin primer arqueo → los 12 meses en null", () => {
    const out = buildDiferenciaCajaSerie({ year: 2025, primerArqueo: null, totalesPorAnio: {} });
    expect(Object.keys(out)).toHaveLength(12);
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });

  it("primer arqueo en un año posterior al pedido → los 12 meses en null", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2024,
      primerArqueo: { anio: 2025, mes: 3 },
      totalesPorAnio: {},
    });
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });

  it("un solo año: meses <= primer arqueo en null, mes con arqueo posterior con valor", () => {
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
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect(out[3]).toBeNull(); // mes del primer arqueo
    // abr: delta = 600 - 500 = 100; contable = (120-50)-30 = 40; acc = 100 - 40 = 60
    expect(out[4]).toBe(60);
    expect(out[5]).toBeNull(); // sin datos → sin arqueo → null
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
    expect(out[1]).toBeNull();
    // feb 2026: delta = 900 - 1000 = -100; contable ene = (120-50)-30 = 40; contable feb = (110-45)-25 = 40
    // acc ene = 0 - 40 = -40; acc feb = -40 + (-100 - 40) = -180
    expect(out[2]).toBe(-180);
  });

  it("año faltante en totalesPorAnio se trata como año vacío (no rompe)", () => {
    const out = buildDiferenciaCajaSerie({
      year: 2026,
      primerArqueo: { anio: 2025, mes: 1 },
      totalesPorAnio: { 2025: totales({ disponible: { 1: 1000 } }) }, // falta 2026
    });
    expect(Object.keys(out)).toHaveLength(12);
    expect(out[1]).toBeNull();
  });
});
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `npx vitest run lib/dashboard/diferencia-caja-serie.test.ts`
Expected: FAIL — `Cannot find module './diferencia-caja-serie'`.

- [ ] **Step 3: Implementar el helper**

Crear `lib/dashboard/diferencia-caja-serie.ts`:

```ts
// Arma la serie mensual continua para Diferencia de caja y corre el cálculo acumulado.
// Puro: sin fetch, sin Prisma, sin React — testeable con fixtures. La orquestación de datos
// (primer arqueo + sumas SQL) vive en app/api/dashboard/diferencia-caja/route.ts.

import { MONTH_IDXS } from "@/lib/dashboard/constants";
import { computeDiferenciaCajaAcumulada, type MesDatos } from "@/lib/dashboard/resultados-calc";

export interface TotalesAnio {
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  gananciaPorMes: Record<number, number>;
  disponiblePorMes: Record<number, number | null>;
}

// LÍMITE CONOCIDO (I-3, ver spec 2026-09-09 §1.5 y el fix wave del 24-ago-2026): los agregados
// de compras/ventas arman mapas dispersos — una clave de mes existe solo si hubo filas que
// matchearon. El `?? 0` no distingue "el mes tuvo $0 de verdad" de "no hay dato para este mes"
// (p. ej. import pendiente). Bajo el modelo acumulado, un `0` de un mes con dato faltante
// subvalúa en silencio el acumulado en el próximo mes con arqueo mostrado. Resolverlo requiere
// decidir cómo se detecta "el mes tiene datos de operación" y qué se muestra si no los tiene
// — decisión pospuesta explícitamente (2026-09-09), documentada no resuelta.
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

export function buildDiferenciaCajaSerie(input: {
  year: number;
  primerArqueo: { anio: number; mes: number } | null;
  totalesPorAnio: Record<number, TotalesAnio>;
}): Record<number, number | null> {
  const { year, primerArqueo, totalesPorAnio } = input;

  const vacio: Record<number, number | null> = {};
  for (const mes of MONTH_IDXS) vacio[mes] = null;
  if (primerArqueo == null || primerArqueo.anio > year) return vacio;

  const anios: number[] = [];
  for (let a = primerArqueo.anio; a <= year; a++) anios.push(a);

  const serie: MesDatos[] = anios.flatMap((anio) =>
    toSerieDeUnAnio(anio, totalesPorAnio[anio] ?? ANIO_VACIO),
  );
  const acumulado = computeDiferenciaCajaAcumulada(serie, primerArqueo);

  const offset = (year - primerArqueo.anio) * 12;
  const out: Record<number, number | null> = {};
  for (const mes of MONTH_IDXS) out[mes] = acumulado[offset + (mes - 1)] ?? null;
  return out;
}
```

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `npx vitest run lib/dashboard/diferencia-caja-serie.test.ts`
Expected: PASS — los 5 tests.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/diferencia-caja-serie.ts lib/dashboard/diferencia-caja-serie.test.ts
git commit -m "feat(dashboard): buildDiferenciaCajaSerie — serie continua + cálculo, puro

Extrae el armado de MesDatos[] multi-año y el recorte al año pedido
del hook use-diferencia-caja a una función pura testeable. Hospeda el
comentario del límite I-3.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Helper `findPrimerArqueo`

**Files:**
- Create: `lib/dashboard/primer-arqueo.ts`

**Interfaces:**
- Consumes: `prisma` de `@/lib/prisma`.
- Produces: `findPrimerArqueo(filtro: { localId?: number; puntoDeVentaId?: number }): Promise<{ anio: number; mes: number } | null>` — la primera fila de `flujoCajaManual` con `monto != 0` que matchea el filtro, ordenada por `(anio, mes)` ascendente.

- [ ] **Step 1: Implementar el helper**

Crear `lib/dashboard/primer-arqueo.ts`:

```ts
import { prisma } from "@/lib/prisma";

// El arqueo (Disponible en caja) más viejo cargado que matchea el filtro de local/PDV.
// "Diferencia de caja" solo tiene sentido a partir del mes SIGUIENTE a este (el arqueo es la
// caja inicial del mes que viene — ver spec 2026-08-24 §1). Un $0 es "sin dato", no ancla el
// cálculo (spec 2026-08-31), por eso `monto: { not: 0 }`.
export async function findPrimerArqueo(filtro: {
  localId?: number;
  puntoDeVentaId?: number;
}): Promise<{ anio: number; mes: number } | null> {
  const primera = await prisma.flujoCajaManual.findFirst({
    where: {
      monto: { not: 0 },
      ...(filtro.localId !== undefined ? { localId: filtro.localId } : {}),
      ...(filtro.puntoDeVentaId !== undefined ? { puntoDeVentaId: filtro.puntoDeVentaId } : {}),
    },
    orderBy: [{ anio: "asc" }, { mes: "asc" }],
    select: { anio: true, mes: true },
  });
  return primera ? { anio: primera.anio, mes: primera.mes } : null;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores (o los mismos errores preexistentes que en `main` — comparar si hay ruido).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add lib/dashboard/primer-arqueo.ts
git commit -m "refactor(dashboard): extrae findPrimerArqueo a helper compartible

Misma query que hoy vive inline en la ruta /flujo-caja/primer-arqueo.
La va a usar el endpoint nuevo /diferencia-caja; la ruta standalone se
borra en el task del hook.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Endpoint `GET /api/dashboard/diferencia-caja`

**Files:**
- Create: `app/api/dashboard/diferencia-caja/route.ts`
- Modify: `lib/dashboard/params.ts` (agregar `buildDiferenciaCajaUrl`)

**Interfaces:**
- Consumes: `findPrimerArqueo` (Task 3); `buildDiferenciaCajaSerie`, `type TotalesAnio` (Task 2); `buildPivotConditions` de `lib/dashboard/query-builders.ts`; `aggregateFlujoCajaPorMes` de `lib/dashboard/flujo-caja-agg.ts`; `toNumber` de `lib/dashboard/pivot-utils.ts`; `MONTH_IDXS`, `type VisibilidadField` de `lib/dashboard/constants.ts`.
- Produces:
  - Endpoint `GET /api/dashboard/diferencia-caja?year=&localId=&puntoDeVentaId=` → `200 { diferenciaPorMes: Record<number, number | null> }` (claves 1..12), `400 { error }` si params inválidos, `401` sin sesión, `500 { error }` ante fallo.
  - `buildDiferenciaCajaUrl(year: number, localId?: number, pdvId?: number): string` en `lib/dashboard/params.ts`.

- [ ] **Step 1: Agregar `buildDiferenciaCajaUrl` a params.ts**

En `lib/dashboard/params.ts`, agregar (junto a `buildFlujoCajaUrl`):

```ts
export function buildDiferenciaCajaUrl(year: number, localId?: number, pdvId?: number): string {
  const sp = new URLSearchParams({ year: String(year) });
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("puntoDeVentaId", String(pdvId));
  return `/api/dashboard/diferencia-caja?${sp.toString()}`;
}
```

- [ ] **Step 2: Crear el route handler**

Crear `app/api/dashboard/diferencia-caja/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import { aggregateFlujoCajaPorMes } from "@/lib/dashboard/flujo-caja-agg";
import { toNumber } from "@/lib/dashboard/pivot-utils";
import { MONTH_IDXS, type VisibilidadField } from "@/lib/dashboard/constants";
import { findPrimerArqueo } from "@/lib/dashboard/primer-arqueo";
import { buildDiferenciaCajaSerie, type TotalesAnio } from "@/lib/dashboard/diferencia-caja-serie";

export const dynamic = "force-dynamic";

// Sin .min/.max en year: un año fuera de rango responde 200 con los 12 meses en null
// (mismo criterio que GET /api/dashboard/flujo-caja), no 400.
const getQuerySchema = z.object({
  year: z.coerce.number().int(),
  localId: z.coerce.number().int().optional(),
  puntoDeVentaId: z.coerce.number().int().optional(),
});

interface MesSumRow {
  mes: number;
  total: Prisma.Decimal | string | number | null;
}

// Suma mensual de compras (v_compras_distribuidas) para una vista de visibilidad. Reproduce el
// columnTotals que hoy calcula el endpoint de pivot, pero con GROUP BY en la DB en vez de volcar
// fila por fila. Mismos LEFT JOIN (cc, rc) que el pivot necesita para el predicado de visibilidad.
async function sumComprasPorMes(
  anio: number,
  localId: number | undefined,
  pdvId: number | undefined,
  visibilidadCol: VisibilidadField,
): Promise<Record<number, number>> {
  const conditions = buildPivotConditions({
    year: anio,
    tableAlias: "c",
    localId,
    pdvId,
    filterRubrosOcultos: true,
    visibilidadCol,
  });
  const where = Prisma.join(conditions, " AND ");
  const rows = await prisma.$queryRaw<MesSumRow[]>(Prisma.sql`
    SELECT
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
      SUM(COALESCE(c."importeManual", c.importe))                 AS total
    FROM v_compras_distribuidas c
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
    WHERE ${where}
    GROUP BY 1
  `);
  const out: Record<number, number> = {};
  for (const r of rows) out[r.mes] = toNumber(r.total ?? 0);
  return out;
}

// Suma mensual de ventas. Mismo WHERE base que el endpoint de pivot-ventas (hasFechaManual: false,
// sin filtro de visibilidad).
async function sumVentasPorMes(
  anio: number,
  localId: number | undefined,
  pdvId: number | undefined,
): Promise<Record<number, number>> {
  const conditions = buildPivotConditions({
    year: anio,
    tableAlias: "v",
    hasFechaManual: false,
    localId,
    pdvId,
  });
  const where = Prisma.join(conditions, " AND ");
  const rows = await prisma.$queryRaw<MesSumRow[]>(Prisma.sql`
    SELECT
      EXTRACT(MONTH FROM v.fecha)::int            AS mes,
      SUM(COALESCE(v."importeManual", v.importe)) AS total
    FROM ventas v
    WHERE ${where}
    GROUP BY 1
  `);
  const out: Record<number, number> = {};
  for (const r of rows) out[r.mes] = toNumber(r.total ?? 0);
  return out;
}

// Disponible en caja por mes — reusa la agregación pura de precedencia local/PDV.
async function disponiblePorMes(
  anio: number,
  localId: number | undefined,
  puntoDeVentaId: number | undefined,
): Promise<Record<number, number | null>> {
  const rows = await prisma.flujoCajaManual.findMany({
    where: {
      anio,
      monto: { not: 0 },
      ...(localId !== undefined ? { localId } : {}),
      ...(puntoDeVentaId !== undefined ? { puntoDeVentaId } : {}),
    },
    select: { localId: true, puntoDeVentaId: true, mes: true, monto: true },
  });
  return aggregateFlujoCajaPorMes(
    rows.map((r) => ({
      localId: r.localId,
      puntoDeVentaId: r.puntoDeVentaId,
      mes: r.mes,
      monto: Number(r.monto),
    })),
    puntoDeVentaId,
  );
}

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    year: searchParams.get("year") ?? undefined,
    localId: searchParams.get("localId") ?? undefined,
    puntoDeVentaId: searchParams.get("puntoDeVentaId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }
  const { year, localId, puntoDeVentaId } = parsed.data;

  try {
    const primerArqueo = await findPrimerArqueo({ localId, puntoDeVentaId });

    if (primerArqueo == null || primerArqueo.anio > year) {
      const vacio: Record<number, number | null> = {};
      for (const mes of MONTH_IDXS) vacio[mes] = null;
      return NextResponse.json({ diferenciaPorMes: vacio });
    }

    const anios: number[] = [];
    for (let a = primerArqueo.anio; a <= year; a++) anios.push(a);

    const totalesPorAnio: Record<number, TotalesAnio> = {};
    await Promise.all(
      anios.map(async (anio) => {
        const [ingresosPorMes, egresosPorMes, gananciaPorMes, disponible] = await Promise.all([
          sumVentasPorMes(anio, localId, puntoDeVentaId),
          sumComprasPorMes(anio, localId, puntoDeVentaId, "visibleEnDashboard"),
          sumComprasPorMes(anio, localId, puntoDeVentaId, "visibleEnResultados"),
          disponiblePorMes(anio, localId, puntoDeVentaId),
        ]);
        totalesPorAnio[anio] = {
          ingresosPorMes,
          egresosPorMes,
          gananciaPorMes,
          disponiblePorMes: disponible,
        };
      }),
    );

    const diferenciaPorMes = buildDiferenciaCajaSerie({ year, primerArqueo, totalesPorAnio });
    return NextResponse.json({ diferenciaPorMes });
  } catch (err) {
    console.error("[GET /api/dashboard/diferencia-caja]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compila sin errores de tipos. (Corre `prisma generate` antes por el script.)

- [ ] **Step 4: Verificación manual del endpoint (con dev server)**

Run: `npm run dev` en una terminal aparte. Con una sesión iniciada en el browser, abrir en el navegador (que manda la cookie de sesión):

```
http://localhost:3000/api/dashboard/diferencia-caja?year=2025
```

Expected:
- Responde `200` con `{ "diferenciaPorMes": { "1": ..., ..., "12": ... } }`.
- Los meses que en la pantalla de Resultados 2025 NO tienen Disponible en caja cargado → `null`.
- Los meses con arqueo cargado → un número.
- Probar también `?year=2025&localId=<un local real>` y un año sin ningún arqueo (`?year=2020`) → 12 `null`.

Anotar 2-3 valores para comparar contra la pantalla en el Task 7.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add app/api/dashboard/diferencia-caja/route.ts lib/dashboard/params.ts
git commit -m "feat(dashboard): endpoint único GET /api/dashboard/diferencia-caja

Colapsa el fan-out multi-año/multi-endpoint del hook en un request:
primer arqueo + 3 sumas SQL por mes (GROUP BY, no volcado fila-por-fila)
+ arqueos + cálculo puro. requireAuth, Zod safeParse, errores explícitos.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Reescribir `useDiferenciaCaja` + borrar la ruta vieja

**Files:**
- Modify: `hooks/use-diferencia-caja.ts` (reescritura completa)
- Modify: `lib/dashboard/params.ts` (borrar `buildPrimerArqueoUrl`)
- Modify: `components/dashboard/caja-rows.tsx:104-110` (invalidación de query key)
- Delete: `app/api/dashboard/flujo-caja/primer-arqueo/route.ts`

**Interfaces:**
- Consumes: `buildDiferenciaCajaUrl` (Task 4); `useFetchQuery` de `hooks/use-fetch-query.ts`; `MONTH_IDXS` de `lib/dashboard/constants.ts`.
- Produces: `useDiferenciaCaja({ year, localId, pdvId }: { year: number; localId?: number; pdvId?: number }): { diferenciaPorMes: Record<number, number | null>; isLoading: boolean; isError: boolean }` — **contrato de retorno idéntico al actual**, `caja-rows.tsx` no cambia su forma de consumo.

- [ ] **Step 1: Reescribir el hook**

Reemplazar todo el contenido de `hooks/use-diferencia-caja.ts` por:

```ts
"use client";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { buildDiferenciaCajaUrl } from "@/lib/dashboard/params";
import { MONTH_IDXS } from "@/lib/dashboard/constants";

interface Params {
  year: number;
  localId?: number;
  pdvId?: number;
}

interface DiferenciaCajaResponse {
  diferenciaPorMes: Record<number, number | null>;
}

// Diferencia de caja acumulada (ver spec 2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico
// y Fix_Diferencia_Caja.pdf). Toda la orquestación —primer arqueo, agregados por mes del rango de
// años, cálculo acumulado— vive server-side en GET /api/dashboard/diferencia-caja; acá solo se
// consume en un request. Un mes sin arqueo cargado viene como null (celda "—").
export function useDiferenciaCaja({ year, localId, pdvId }: Params) {
  const { data, isLoading, isError } = useFetchQuery<DiferenciaCajaResponse>(
    ["diferencia-caja", year, localId, pdvId],
    buildDiferenciaCajaUrl(year, localId, pdvId),
    { staleTime: 30_000 },
  );

  const diferenciaPorMes: Record<number, number | null> = {};
  for (const mes of MONTH_IDXS) diferenciaPorMes[mes] = data?.diferenciaPorMes[mes] ?? null;

  return { diferenciaPorMes, isLoading, isError };
}
```

- [ ] **Step 2: Actualizar la invalidación en caja-rows.tsx**

En `components/dashboard/caja-rows.tsx`, en `handleSaveFlujoCaja` (actual líneas ~104-110), reemplazar:

```ts
      // Invalida las query keys nuevas de "Diferencia de caja" (I-2): sin esto, cargar el
      // primer arqueo de la historia deja cacheado primerArqueo: null y la fila entera se queda
      // en "—" hasta un remount/refetch no relacionado — es la primera interacción esperable de
      // un cliente con esta feature, tiene que reflejarse de inmediato.
      await queryClient.invalidateQueries({ queryKey: ["diferencia-caja-primer-arqueo"] });
      await queryClient.invalidateQueries({ queryKey: ["diferencia-caja-year-totals"] });
```

por:

```ts
      // Invalida "Diferencia de caja" (I-2): cargar el primer arqueo de la historia cambia el
      // resultado de todos los meses; sin esto la fila se queda en "—" hasta un refetch no
      // relacionado. La key nueva es un solo prefijo (endpoint único, ver spec 2026-09-09).
      await queryClient.invalidateQueries({ queryKey: ["diferencia-caja"] });
```

- [ ] **Step 3: Borrar `buildPrimerArqueoUrl` de params.ts**

En `lib/dashboard/params.ts`, borrar la función `buildPrimerArqueoUrl` completa (actual líneas ~108-114). Dejar `buildRangoAniosUrl` y el resto intactos.

- [ ] **Step 4: Borrar la ruta standalone**

```bash
git rm app/api/dashboard/flujo-caja/primer-arqueo/route.ts
```

- [ ] **Step 5: Verificar que no quedaron referencias colgadas**

Run: `grep -rn "primer-arqueo\|buildPrimerArqueoUrl\|diferencia-caja-primer-arqueo\|diferencia-caja-year-totals\|fetchYearTotals\|toSerieDeUnAnio" --include='*.ts' --include='*.tsx' .`
Expected: sin resultados en código vivo. (Puede aparecer en `docs/superpowers/specs/2026-08-24-*` y en este plan — eso está bien.)

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: compila. Si `next build` se queja de un import roto, revisar el grep del Step 5.

- [ ] **Step 7: Correr toda la suite de tests**

Run: `npm run test`
Expected: PASS — nada roto (los tests de `resultados-calc` y `diferencia-caja-serie` ya cubren la lógica; el hook no tiene test propio).

- [ ] **Step 8: Verificación manual en el browser**

Con `npm run dev`: abrir el Dashboard de Resultados, año 2025.
Expected:
- La fila "Diferencia de caja" carga (más rápido que antes en un refresh duro).
- Meses sin Disponible en caja → "—" (no un número repetido).
- Editar un Disponible en caja de un mes → la fila Diferencia de caja se actualiza sin recargar.

- [ ] **Step 9: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 10: Commit**

```bash
git add hooks/use-diferencia-caja.ts lib/dashboard/params.ts components/dashboard/caja-rows.tsx
git rm app/api/dashboard/flujo-caja/primer-arqueo/route.ts
git commit -m "refactor(dashboard): useDiferenciaCaja consume el endpoint único

De ~135 líneas (useQueries multi-año + fetchYearTotals + cálculo client)
a un wrapper de useFetchQuery. Borra la ruta /flujo-caja/primer-arqueo y
buildPrimerArqueoUrl (sin consumidores). Invalidación por prefijo único.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Spinner en la sección Caja + textos del popover

**Files:**
- Modify: `components/dashboard/caja-rows.tsx`

**Interfaces:**
- Consumes: `Spinner` de `components/ui/spinner.tsx` (`<Spinner size="sm" | "md" | "lg" className?>`).
- Produces: `ValueCell` gana `loading?: boolean`; cuando es `true` renderiza `<Spinner size="sm" />` en vez de `text`.

- [ ] **Step 1: Importar Spinner**

En `components/dashboard/caja-rows.tsx`, agregar al bloque de imports:

```ts
import { Spinner } from "@/components/ui/spinner";
```

- [ ] **Step 2: Agregar la prop `loading` a `ValueCell`**

En la definición de `ValueCell` (actual líneas ~27-51), agregar `loading` al tipo y al render:

```tsx
function ValueCell({
  text,
  negative,
  gray,
  loading = false,
  base = VALUE_TD,
  className,
  title,
}: {
  text: string;
  negative: boolean;
  gray: boolean;
  loading?: boolean;
  base?: string;
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn(base, className)}
      style={{ color: gray ? RESULT_COLORS.noData : negative ? RESULT_COLORS.negative : RESULT_COLORS.positive }}
    >
      {loading ? <Spinner size="sm" className="inline-block align-middle" /> : text}
    </td>
  );
}
```

- [ ] **Step 3: `<Spinner>` en las celdas de "Disponible en caja"**

En la celda de mes de Disponible en caja (actual línea ~166), reemplazar:

```tsx
                    {flujoCajaLoading ? "…" : value != null ? fmtARSDecimal(value) : "—"}
```

por:

```tsx
                    {flujoCajaLoading ? <Spinner size="sm" className="inline-block align-middle" /> : value != null ? fmtARSDecimal(value) : "—"}
```

En la celda de total de Disponible en caja (actual línea ~179), reemplazar:

```tsx
          {flujoCajaLoading ? "…" : flujoCajaTieneDatos ? fmtARSDecimal(flujoCajaTotal) : "—"}
```

por:

```tsx
          {flujoCajaLoading ? <Spinner size="sm" className="inline-block align-middle" /> : flujoCajaTieneDatos ? fmtARSDecimal(flujoCajaTotal) : "—"}
```

- [ ] **Step 4: `loading` en las celdas de "Diferencia de caja"**

En la celda de mes (actual líneas ~221-234), cambiar el `map` a:

```tsx
        {months.map((mes) => {
          const diferencia = diferenciaPorMes[mes];
          const noData = !diferenciaLoading && diferencia == null;
          return (
            <ValueCell
              key={mes}
              base={VALUE_TD}
              className={cn("bg-muted", cardCellClasses("last", "mid"))}
              title={diferenciaError ? "Error al cargar Diferencia de caja" : undefined}
              loading={diferenciaLoading}
              text={diferencia == null ? "—" : fmtARS(diferencia)}
              negative={diferencia != null && diferencia < 0}
              gray={noData}
            />
          );
        })}
```

En la celda de total (actual líneas ~236-255), cambiar el IIFE a:

```tsx
        {(() => {
          // El acumulado ya arrastra el saldo mes a mes — el total anual es el último mes
          // visible con cálculo válido (con la regla nueva: el último mes con arqueo cargado).
          let total: number | null = null;
          for (let i = months.length - 1; i >= 0; i--) {
            const v = diferenciaPorMes[months[i]];
            if (v != null) { total = v; break; }
          }
          const noData = !diferenciaLoading && total == null;
          return (
            <ValueCell
              base={TOTAL_TD}
              className={cn("bg-muted font-bold", cardCellClasses("last", "mid"))}
              title="Saldo acumulado al último mes con arqueo cargado"
              loading={diferenciaLoading}
              text={total == null ? "—" : fmtARS(total)}
              negative={total != null && total < 0}
              gray={noData}
            />
          );
        })()}
```

- [ ] **Step 5: Actualizar los textos del popover**

En el `PopoverContent` de "Diferencia de caja", reemplazar el párrafo (actual líneas ~199-202):

```tsx
                <p className="mt-1.5">
                  Se acumula mes a mes como un resumen bancario, arrancando en el mes siguiente
                  al primer arqueo cargado.
                </p>
```

por:

```tsx
                <p className="mt-1.5">
                  Se acumula mes a mes como un resumen bancario, arrancando en el mes siguiente
                  al primer arqueo cargado. Solo los meses con Disponible en caja cargado muestran
                  un valor; el resto queda en “—”.
                </p>
```

Y la línea "Sin dato:" (actual líneas ~214-215), reemplazar el texto por:

```tsx
                  <span className="h-5 flex items-center justify-center font-semibold" style={{ color: RESULT_COLORS.noData }} aria-hidden>—</span>
                  <span><span className="font-medium text-foreground/80">Sin dato:</span> mes anterior o igual al primer arqueo, o cualquier mes sin un arqueo cargado (un arqueo en $0 cuenta como sin dato).</span>
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 7: Verificación visual**

Con `npm run dev`: refrescar el Dashboard de Resultados con la red throttled (DevTools → Network → Slow 3G) para ver el estado de carga.
Expected:
- Las 4 celdas de la sección Caja (Disponible en caja mes + total, Diferencia de caja mes + total) muestran un spinner girando, no `…`.
- Al terminar la carga: números / "—" normales.
- El popover de Diferencia de caja refleja el texto nuevo.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 9: Commit**

```bash
git add components/dashboard/caja-rows.tsx
git commit -m "feat(dashboard): spinner en la sección Caja mientras carga

Reemplaza el '…' por <Spinner size=sm> en las 4 celdas de Caja
(Disponible en caja y Diferencia de caja, mes y total). Actualiza el
popover: solo los meses con arqueo cargado muestran valor.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Verificación contra producción + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-fix-diferencia-caja-design.md` (nota de reversión de CA-03)
- Modify: `/Users/imanolalvarez/.claude/projects/-Users-imanolalvarez-Documents-lazarillo-gestion/memory/project_fix_diferencia_caja_spec.md` (estado)
- Modify: `/Users/imanolalvarez/.claude/projects/-Users-imanolalvarez-Documents-lazarillo-gestion/memory/MEMORY.md` (línea del índice)

**Interfaces:**
- Consumes: el endpoint y la UI de los Tasks 4-6.
- Produces: nada de código — cierre de verificación y trazabilidad documental.

- [ ] **Step 1: Verificación de correctitud contra los valores reales (criterio de cierre)**

Con `npm run dev` y una sesión real, para al menos 3 combinaciones `(year, localId, puntoDeVentaId)` — incluyendo el caso 2025 que Diego señaló y una vista "todos los locales":

1. Abrir el Dashboard de Resultados en esa combinación, anotar cada valor visible de la fila "Diferencia de caja" y el total anual.
2. Comparar mes a mes contra lo esperado:
   - **Meses sin Disponible en caja cargado → "—".** (Regla nueva, lo que reportó Diego.)
   - **Meses con arqueo → un número.** Verificar que ese número coincide con `(Resultado OP − Ganancia + variación de Disponible)` acumulado desde el primer arqueo — cruzar contra las filas "Resultado OP", "Ganancia" y "Disponible en caja" de la misma pantalla para 1-2 meses a mano.
   - **Total anual = valor del último mes del año con arqueo cargado.**
3. Hard-refresh (Cmd+Shift+R) y cronometrar a ojo: la fila debe aparecer notablemente más rápido que en `main` (comparar contra una pestaña en la versión vieja si hace falta).

Si algún número no cuadra → **parar**, no mergear. El riesgo conocido (spec §5) es que el `SUM(COALESCE(importeManual, importe))` plano no reproduzca exacto el `columnTotals` de los pivots (rama distribuida de `v_compras_distribuidas`, prorrateo). Si aparece una discrepancia, documentarla y volver al Task 4.

- [ ] **Step 2: Nota de reversión en el spec del 24-ago**

En `docs/superpowers/specs/2026-08-24-fix-diferencia-caja-design.md`, agregar al final de la sección 5 (criterios de aceptación), después de la tabla:

```markdown
> **Actualización 2026-09-09:** la parte de *display* de CA-03 fue revertida por
> `2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico.md`. Un mes sin arqueo
> cargado ahora muestra "—", no el acumulado corriente. La *continuidad* de CA-03 (el
> acumulador no se corta en meses sin arqueo) se mantiene: un arqueo posterior sigue
> reconciliando contra el anterior.
```

- [ ] **Step 3: Actualizar la memoria del proyecto**

En `/Users/imanolalvarez/.claude/projects/-Users-imanolalvarez-Documents-lazarillo-gestion/memory/project_fix_diferencia_caja_spec.md`, agregar una sección al final:

```markdown

## Actualización 09-sep-2026 — celda vacía sin arqueo + endpoint único

- **Cambio de criterio de Diego (reunión de demo):** un mes sin "Disponible en caja"
  cargado debe mostrar "—", nunca un número. Revierte el *display* de CA-03 del spec del
  24-ago (que mostraba el acumulado en todos los meses posteriores al primer arqueo).
- **Opción A elegida:** el acumulador sigue corriendo por detrás sobre los meses sin
  arqueo; un arqueo posterior reconcilia contra el anterior arrastrando los meses del medio.
  Solo cambia qué se dibuja.
- **Total anual** = valor del último mes del año con arqueo cargado.
- **Optimización:** se reemplazó el fan-out del hook (`primer-arqueo` + 4 endpoints × N años)
  por un endpoint único `GET /api/dashboard/diferencia-caja` con agregados SQL server-side.
  Se borró la ruta `/api/dashboard/flujo-caja/primer-arqueo`.
- **Spinner** en las 4 celdas de la sección Caja mientras cargan.
- **I-3 sigue sin resolver** (mapas dispersos: `?? 0` no distingue "$0 real" de "sin dato").
  Documentada en `lib/dashboard/diferencia-caja-serie.ts`. Decisión de atacarla: pospuesta.
- Spec: `docs/superpowers/specs/2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico.md`
- Plan: `docs/superpowers/plans/2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico.md`
```

Y en `/Users/imanolalvarez/.claude/projects/-Users-imanolalvarez-Documents-lazarillo-gestion/memory/MEMORY.md`, actualizar la línea de `project_fix_diferencia_caja_spec.md` para mencionar la actualización del 09-sep (mes sin arqueo → "—" + endpoint único).

- [ ] **Step 4: Suite completa + lint + build**

Run: `npm run test && npm run lint && npm run build`
Expected: los tres en verde.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-24-fix-diferencia-caja-design.md
git commit -m "docs(spec): nota de reversión del display de CA-03 (fix 2026-09-09)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Los archivos de memoria fuera del repo no van al commit.)

- [ ] **Step 6: Cierre de rama**

Invocar la skill `superpowers:finishing-a-development-branch` para decidir el merge de `fix/diferencia-caja-gate-arqueo` a `main` (conventional commits, sección 6 del CLAUDE.md). Antes del merge: correr `superpowers:verification-before-completion`.

---

## Self-Review

**1. Spec coverage:**

| Sección del spec | Task |
|---|---|
| §1.3 Decisión: mes sin arqueo → "—", continuidad por detrás | Task 1 (Steps 4-5) |
| §1.4 Latencia: endpoint único, agregados SQL, sin waterfall | Task 4 |
| §1.5 I-3 fuera de alcance, comentario en el helper | Task 2 (Step 3, comentario) |
| §2 Alcance: `primer-arqueo.ts` | Task 3 |
| §2 Alcance: `diferencia-caja-serie.ts` | Task 2 |
| §2 Alcance: endpoint nuevo | Task 4 |
| §2 Alcance: `computeDiferenciaCajaAcumulada` | Task 1 |
| §2 Alcance: `useDiferenciaCaja` reescrito | Task 5 (Step 1) |
| §2 Alcance: `caja-rows.tsx` spinner + textos + invalidación | Task 5 (Step 2), Task 6 |
| §2 Limpieza: borrar ruta + `buildPrimerArqueoUrl` | Task 5 (Steps 3-4) |
| §2 Tests reescritos + nuevos | Task 1 (Steps 1-2), Task 2 (Step 1) |
| §3.1 Endpoint: auth, Zod, filtros, force-dynamic, errores | Task 4 (Step 2) |
| §3.2 `findPrimerArqueo` | Task 3 |
| §3.3 `buildDiferenciaCajaSerie` + I-3 | Task 2 |
| §3.4 cambio de una línea + comentario | Task 1 (Steps 4-5) |
| §3.5 hook reescrito, contrato igual, `buildDiferenciaCajaUrl` | Task 4 (Step 1), Task 5 (Step 1) |
| §3.6 UI: `loading` en ValueCell, spinner en spans, popover, invalidación | Task 5 (Step 2), Task 6 |
| §4 Testing: `resultados-calc.test.ts`, `diferencia-caja-serie.test.ts`, verificación manual | Task 1, Task 2, Task 7 (Step 1) |
| §5 Riesgo de correctitud de los agregados → verificación contra producción como cierre | Task 7 (Step 1) |
| §5 Reversión de CA-03 documentada + memoria | Task 7 (Steps 2-3) |

Sin gaps.

**2. Placeholder scan:** Sin "TBD"/"TODO"/"handle edge cases". Todos los steps de código llevan el código real. El único punto abierto del spec ("forma del rango SQL — a decidir en el plan") quedó resuelto: una query por año dentro de `Promise.all` (Task 4, `sumComprasPorMes`/`sumVentasPorMes` reciben `anio` puntual, el route itera `anios`).

**3. Type consistency:**
- `findPrimerArqueo(filtro: { localId?: number; puntoDeVentaId?: number }): Promise<{ anio: number; mes: number } | null>` — definida en Task 3, consumida idéntica en Task 4.
- `TotalesAnio` — definida en Task 2, importada como tipo en Task 4 (`import { buildDiferenciaCajaSerie, type TotalesAnio }`).
- `buildDiferenciaCajaSerie(input: { year; primerArqueo; totalesPorAnio })` — firma idéntica en Task 2 (definición), Task 4 (uso).
- `buildDiferenciaCajaUrl(year, localId?, pdvId?)` — definida en Task 4 (Step 1), consumida en Task 5 (Step 1).
- `useDiferenciaCaja` — contrato de retorno `{ diferenciaPorMes, isLoading, isError }` igual al actual; `caja-rows.tsx` (Task 6) sigue leyendo `diferenciaPorMes`/`diferenciaLoading`/`diferenciaError`.
- `computeDiferenciaCajaAcumulada` — firma sin cambios (Task 1); Task 2 la importa con la misma firma.
- `ValueCell` — `loading?: boolean` agregada en Task 6 (Step 2), usada en Task 6 (Step 4). Los call sites viejos sin `loading` siguen válidos (default `false`).
- `Spinner` — `size?: "sm" | "md" | "lg"`, `className?: string` (verificado en `components/ui/spinner.tsx`).

Consistente.
