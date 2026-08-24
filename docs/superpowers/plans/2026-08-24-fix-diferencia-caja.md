# Fix Diferencia de caja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el modelo delta actual de "Diferencia de caja" (Dashboard de Resultados) por
un modelo acumulado con gate en el primer arqueo cargado, según el requerimiento de Diego
(`Fix_Diferencia_Caja.pdf`, 21-ago-2026).

**Architecture:** Nuevo endpoint de solo lectura ubica el primer mes con arqueo cargado. Una
función pura nueva (`computeDiferenciaCajaAcumulada`) reemplaza `diferenciaCajaMensual`,
aplicando el gate y acumulando desde el mes siguiente al primer arqueo. `useDiferenciaCaja` se
reescribe para orquestar el fetch multi-año (cuando el primer arqueo está en un año anterior al
visualizado) y armar la serie continua que consume la función pura. `caja-rows.tsx` ajusta el
total anual y los textos que describen la fórmula.

**Tech Stack:** Next.js 16 App Router (Route Handlers), Prisma 7 + `@supabase/ssr` (`requireAuth`),
TanStack Query (`useQueries`), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-fix-diferencia-caja-design.md`

## Global Constraints

- Dato financiero visible al cliente — el criterio de cierre final incluye contraste manual
  contra los 3 valores reales que Diego señaló como incorrectos, no solo tests unitarios en
  verde (spec sección 6).
- `FlujoCajaManual.monto` es un campo NO-nullable en el schema de Prisma — una fila solo existe
  si el usuario cargó un valor. "Primer arqueo" = primera fila que matchea el filtro, no hay que
  filtrar por `monto IS NOT NULL`.
- Celda sin cálculo válido = `null` en la lógica, nunca `0` — el renderizado de `null` como "—"
  en `caja-rows.tsx` ya existe y no cambia.
- No se toca `PUT /api/dashboard/flujo-caja`, ninguna migración de Prisma, ni ninguna vista fuera
  del Dashboard de Resultados.
- `fetchYearTotals` y su tipo `YearTotals` (en `hooks/use-diferencia-caja.ts`) no cambian de
  forma — solo se invocan más veces.
- Correr `npx tsc --noEmit`, `npm run lint` y `npx vitest run` después de cada task de código.

---

### Task 1: Endpoint de primer arqueo + builder de URL

**Files:**
- Create: `app/api/dashboard/flujo-caja/primer-arqueo/route.ts`
- Modify: `lib/dashboard/params.ts`

**Interfaces:**
- Consumes: `requireAuth` de `@/lib/auth/require-auth` (patrón ya usado en
  `app/api/dashboard/flujo-caja/route.ts`); `prisma` de `@/lib/prisma`.
- Produces: `GET /api/dashboard/flujo-caja/primer-arqueo?localId=&puntoDeVentaId=` →
  `{ primerArqueo: { anio: number; mes: number } | null }`. `buildPrimerArqueoUrl(localId?:
  number, pdvId?: number): string` en `lib/dashboard/params.ts`, usado por Task 3.

No lleva test unitario dedicado — es una query directa de Prisma sin lógica de transformación
propia (mismo criterio ya usado para `import_logs`, ver
`app/api/etl/drive-import/route.ts` y la memoria del proyecto correspondiente). Se verifica por
tipo (`tsc`) + lectura de código + build.

- [ ] **Step 1: Crear el route handler**

Crear `app/api/dashboard/flujo-caja/primer-arqueo/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const getQuerySchema = z.object({
  localId: z.coerce.number().int().optional(),
  puntoDeVentaId: z.coerce.number().int().optional(),
});

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    localId: searchParams.get("localId") ?? undefined,
    puntoDeVentaId: searchParams.get("puntoDeVentaId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }
  const { localId, puntoDeVentaId } = parsed.data;

  try {
    const primera = await prisma.flujoCajaManual.findFirst({
      where: {
        ...(localId !== undefined ? { localId } : {}),
        ...(puntoDeVentaId !== undefined ? { puntoDeVentaId } : {}),
      },
      orderBy: [{ anio: "asc" }, { mes: "asc" }],
      select: { anio: true, mes: true },
    });

    return NextResponse.json({ primerArqueo: primera ? { anio: primera.anio, mes: primera.mes } : null });
  } catch (err) {
    console.error("[GET /api/dashboard/flujo-caja/primer-arqueo]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

Nota: mismo `where` condicional que ya usa `app/api/dashboard/flujo-caja/route.ts:34-39` — sin
`localId`/`puntoDeVentaId`, matchea todas las filas (vista "todos los locales"), igual semántica
que hoy.

- [ ] **Step 2: Agregar el builder de URL**

En `lib/dashboard/params.ts`, agregar después de `buildFlujoCajaUrl` (línea 106):

```ts
export function buildPrimerArqueoUrl(localId?: number, pdvId?: number): string {
  const sp = new URLSearchParams();
  if (localId != null) sp.set("localId", String(localId));
  if (pdvId != null) sp.set("puntoDeVentaId", String(pdvId));
  const qs = sp.toString();
  return `/api/dashboard/flujo-caja/primer-arqueo${qs ? `?${qs}` : ""}`;
}
```

- [ ] **Step 3: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add app/api/dashboard/flujo-caja/primer-arqueo/route.ts lib/dashboard/params.ts
git commit -m "feat(dashboard): agrega endpoint de primer arqueo para Diferencia de caja"
```

---

### Task 2: Función pura `computeDiferenciaCajaAcumulada`

**Files:**
- Modify: `lib/dashboard/resultados-calc.ts`
- Test: `lib/dashboard/resultados-calc.test.ts`

**Interfaces:**
- Consumes: nada nuevo — función pura sin dependencias externas.
- Produces:
  ```ts
  export interface MesDatos {
    anio: number;
    mes: number;
    ingresos: number;
    egresos: number;
    ganancia: number;
    disponible: number | null;
  }

  export function computeDiferenciaCajaAcumulada(
    serie: MesDatos[],
    primerArqueo: { anio: number; mes: number } | null,
  ): (number | null)[]
  ```
  Consumido por Task 3 (`hooks/use-diferencia-caja.ts`). `diferenciaCajaMensual` deja de existir
  — Task 3 no debe importarla.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/dashboard/resultados-calc.test.ts`, reemplazar el `describe("diferenciaCajaMensual", ...)`
completo (líneas 60-89 actuales) por:

```ts
describe("computeDiferenciaCajaAcumulada", () => {
  // Serie de ejemplo: primer arqueo cargado en septiembre (mes 9). CA-01 a CA-03 del PDF.
  const serieBase: MesDatos[] = [
    { anio: 2026, mes: 7, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },  // jul
    { anio: 2026, mes: 8, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },  // ago
    { anio: 2026, mes: 9, ingresos: 100, egresos: 40, ganancia: 20, disponible: 500 },   // sep — primer arqueo
    { anio: 2026, mes: 10, ingresos: 120, egresos: 50, ganancia: 30, disponible: null }, // oct — sin arqueo propio
    { anio: 2026, mes: 11, ingresos: 110, egresos: 45, ganancia: 25, disponible: 600 },  // nov
  ];
  const primerArqueoSep = { anio: 2026, mes: 9 };

  it("CA-01 — sin ningún arqueo, primerArqueo null, todo el resultado es null", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, null);
    expect(resultado).toEqual([null, null, null, null, null]);
  });

  it("CA-02 — julio, agosto y septiembre (mes del primer arqueo inclusive) dan null", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    expect(resultado[0]).toBeNull(); // jul
    expect(resultado[1]).toBeNull(); // ago
    expect(resultado[2]).toBeNull(); // sep, mes del primer arqueo
  });

  it("CA-02 — octubre (mes siguiente al primer arqueo) da el primer valor calculado", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    // saldoInicial = disponible[sep] = 500
    // oct: (120-50) - 30 + (disponible ?? 0) = 70 - 30 + 0 = 40; acumulado = 500 + 40 = 540
    expect(resultado[3]).toBe(540);
  });

  it("CA-03 — octubre sin disponible propio no corta la cadena: noviembre sigue acumulando sobre octubre", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    // nov: (110-45) - 25 + 600 = 65 - 25 + 600 = 640; acumulado = 540 (oct) + 640 = 1180
    expect(resultado[4]).toBe(1180);
  });

  it("CA-04 — los meses sin cálculo válido son null, nunca 0", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, primerArqueoSep);
    expect(resultado[0]).not.toBe(0);
    expect(resultado[0]).toBeNull();
  });

  it("caso cross-año — primer arqueo en el año anterior al último año de la serie, el acumulado sigue de corrido", () => {
    const serieCrossAnio: MesDatos[] = [
      { anio: 2025, mes: 11, ingresos: 100, egresos: 40, ganancia: 20, disponible: null },
      { anio: 2025, mes: 12, ingresos: 100, egresos: 40, ganancia: 20, disponible: 1000 }, // primer arqueo
      { anio: 2026, mes: 1, ingresos: 120, egresos: 50, ganancia: 30, disponible: null },
      { anio: 2026, mes: 2, ingresos: 110, egresos: 45, ganancia: 25, disponible: 900 },
    ];
    const primerArqueoDic2025 = { anio: 2025, mes: 12 };
    const resultado = computeDiferenciaCajaAcumulada(serieCrossAnio, primerArqueoDic2025);
    expect(resultado[0]).toBeNull(); // nov 2025
    expect(resultado[1]).toBeNull(); // dic 2025, mes del primer arqueo
    // ene 2026: saldoInicial 1000 + [(120-50)-30+0] = 1000 + 40 = 1040
    expect(resultado[2]).toBe(1040);
    // feb 2026: 1040 + [(110-45)-25+900] = 1040 + 940 = 1980
    expect(resultado[3]).toBe(1980);
  });

  it("primerArqueo posterior al último mes de la serie (rango mal armado por el caller) da todo null", () => {
    const resultado = computeDiferenciaCajaAcumulada(serieBase, { anio: 2027, mes: 1 });
    expect(resultado).toEqual([null, null, null, null, null]);
  });
});
```

Y actualizar el import en la cabecera del archivo (línea 1-10) para reemplazar
`diferenciaCajaMensual` por `computeDiferenciaCajaAcumulada, type MesDatos`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseMontoARS,
  pctSobreIngresos,
  computeDiferenciaCajaAcumulada,
  type MesDatos,
  heatmapFill,
  heatmapFillZeroAnchored,
  heatmapTextZeroAnchored,
  RESULT_COLORS,
} from "./resultados-calc";
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/dashboard/resultados-calc.test.ts`
Expected: FAIL — `computeDiferenciaCajaAcumulada`/`MesDatos` no existen todavía en
`resultados-calc.ts` (error de import/tipo).

- [ ] **Step 3: Implementar la función**

En `lib/dashboard/resultados-calc.ts`, eliminar `diferenciaCajaMensual` (líneas 20-32 actuales,
comentario incluido) y reemplazar por:

```ts
export interface MesDatos {
  anio: number;
  mes: number;
  ingresos: number;
  egresos: number;
  ganancia: number;
  disponible: number | null;
}

// Diferencia de caja acumulada: arranca en el mes siguiente al primer arqueo cargado
// (`primerArqueo`), usando el Disponible de ese mes como saldo inicial, y acumula mes a mes
// como un resumen bancario. Antes o en el mes del primer arqueo, y si no hay ningún arqueo
// cargado, el resultado es null (nunca 0 — ver Fix_Diferencia_Caja.pdf sección 5.1/CA-04).
// Un mes sin Disponible propio, una vez pasado el gate, no corta la cadena (CA-03): solo aporta
// 0 en ese término puntual, pero sigue acumulando.
export function computeDiferenciaCajaAcumulada(
  serie: MesDatos[],
  primerArqueo: { anio: number; mes: number } | null,
): (number | null)[] {
  const resultado: (number | null)[] = serie.map(() => null);
  if (primerArqueo == null) return resultado;

  const i0 = serie.findIndex((m) => m.anio === primerArqueo.anio && m.mes === primerArqueo.mes);
  if (i0 === -1) return resultado;

  let acc = serie[i0].disponible ?? 0;
  for (let i = i0 + 1; i < serie.length; i++) {
    const m = serie[i];
    acc += (m.ingresos - m.egresos) - m.ganancia + (m.disponible ?? 0);
    resultado[i] = acc;
  }
  return resultado;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/dashboard/resultados-calc.test.ts`
Expected: PASS, todos los tests en verde (incluidos los ya existentes de `parseMontoARS`,
`pctSobreIngresos` y los heatmaps, que no cambian).

- [ ] **Step 5: Verificar tipos y lint**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos. (Va a marcar error en `hooks/use-diferencia-caja.ts` hasta Task 3
— es esperado, ese archivo todavía importa `diferenciaCajaMensual`.)

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/resultados-calc.ts lib/dashboard/resultados-calc.test.ts
git commit -m "feat(dashboard): reemplaza diferenciaCajaMensual por modelo acumulado con gate de primer arqueo"
```

---

### Task 3: Reescribir `useDiferenciaCaja`

**Files:**
- Modify: `hooks/use-diferencia-caja.ts`

**Interfaces:**
- Consumes: `buildPrimerArqueoUrl` (Task 1), `computeDiferenciaCajaAcumulada` + `MesDatos`
  (Task 2), `fetchYearTotals`/`YearTotals` (ya existentes en este mismo archivo, sin cambios de
  forma).
- Produces: `useDiferenciaCaja({ year, localId, pdvId })` devuelve `{ diferenciaPorMes:
  Record<number, number | null>, isLoading: boolean, isError: boolean }` — mismo contrato que
  hoy, consumido sin cambios por `components/dashboard/caja-rows.tsx` (Task 4 solo toca el total
  anual y los textos, no la forma de `diferenciaPorMes`).

No lleva test unitario dedicado (spec sección 4 — no hay infraestructura de test de hooks React
con TanStack Query en este repo; se verifica por tipo + build + la verificación manual final).

- [ ] **Step 1: Reemplazar el contenido completo del archivo**

Reemplazar todo `hooks/use-diferencia-caja.ts` por:

```ts
"use client";
import { useQueries } from "@tanstack/react-query";
import { buildDashboardUrl, buildVentasPivotUrl, buildFlujoCajaUrl, buildPrimerArqueoUrl } from "@/lib/dashboard/params";
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import { computeDiferenciaCajaAcumulada, type MesDatos } from "@/lib/dashboard/resultados-calc";
import type { PivotData } from "@/lib/dashboard/types";

interface FlujoCajaResponse {
  anio: number;
  meses: Record<number, number | null>;
}

interface PrimerArqueoResponse {
  primerArqueo: { anio: number; mes: number } | null;
}

interface YearTotals {
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  gananciaPorMes: Record<number, number>;
  disponiblePorMes: Record<number, number | null>;
}

interface Params {
  year: number;
  localId?: number;
  pdvId?: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error cargando ${url}`);
  return res.json() as Promise<T>;
}

// Trae los 4 totales mensuales del año completo (sin filtro de meses), independiente de
// cualquier filtro de columnas activo en pantalla.
async function fetchYearTotals(year: number, localId?: number, pdvId?: number): Promise<YearTotals> {
  const [ventas, compras, ganancia, flujo] = await Promise.all([
    fetchJson<PivotData>(buildVentasPivotUrl("/api/dashboard/pivot-ventas", { year, localId, pdvId, months: undefined })),
    fetchJson<PivotData>(buildDashboardUrl("/api/dashboard/pivot", { year, localId, pdvId, vista: "compras" })),
    fetchJson<PivotData>(buildDashboardUrl("/api/dashboard/pivot", { year, localId, pdvId, vista: "resultados" })),
    fetchJson<FlujoCajaResponse>(buildFlujoCajaUrl(year, localId, pdvId)),
  ]);
  return {
    ingresosPorMes: ventas.columnTotals,
    egresosPorMes: compras.columnTotals,
    gananciaPorMes: ganancia.columnTotals,
    // Se preserva null (sin arqueo cargado) — no default a 0, es lo que distingue "—" de "$0".
    disponiblePorMes: flujo.meses,
  };
}

function toSerieDeUnAnio(anio: number, totals: YearTotals): MesDatos[] {
  return MONTH_IDXS.map((mes) => ({
    anio,
    mes,
    ingresos: totals.ingresosPorMes[mes] ?? 0,
    egresos: totals.egresosPorMes[mes] ?? 0,
    ganancia: totals.gananciaPorMes[mes] ?? 0,
    disponible: totals.disponiblePorMes[mes] ?? null,
  }));
}

// Diferencia de caja acumulada (ver Fix_Diferencia_Caja.pdf y
// docs/superpowers/specs/2026-08-24-fix-diferencia-caja-design.md): arranca en el mes siguiente
// al primer arqueo cargado, acumulando como un resumen bancario. Si el primer arqueo está en un
// año anterior a `year`, se trae la serie continua desde ese año para no perder el arrastre.
export function useDiferenciaCaja({ year, localId, pdvId }: Params) {
  const primerArqueoQuery = useQueries({
    queries: [
      {
        queryKey: ["diferencia-caja-primer-arqueo", localId, pdvId],
        queryFn: () => fetchJson<PrimerArqueoResponse>(buildPrimerArqueoUrl(localId, pdvId)),
        staleTime: 30_000,
      },
    ],
  })[0];

  const primerArqueo = primerArqueoQuery.data?.primerArqueo ?? null;
  const necesitaTotales = !primerArqueoQuery.isLoading && !primerArqueoQuery.isError && primerArqueo != null && primerArqueo.anio <= year;

  const anios: number[] = necesitaTotales
    ? Array.from({ length: year - primerArqueo!.anio + 1 }, (_, i) => primerArqueo!.anio + i)
    : [];

  const totalesQueries = useQueries({
    queries: anios.map((anio) => ({
      queryKey: ["diferencia-caja-year-totals", anio, localId, pdvId],
      queryFn: () => fetchYearTotals(anio, localId, pdvId),
      staleTime: 30_000,
    })),
  });

  const isLoading = primerArqueoQuery.isLoading || (necesitaTotales && totalesQueries.some((q) => q.isLoading));
  const isError = primerArqueoQuery.isError || totalesQueries.some((q) => q.isError);

  if (isLoading || isError || !necesitaTotales) {
    const diferenciaPorMes: Record<number, number | null> = {};
    for (const mes of MONTH_IDXS) diferenciaPorMes[mes] = null;
    return { diferenciaPorMes, isLoading, isError };
  }

  const serie: MesDatos[] = anios.flatMap((anio, idx) => toSerieDeUnAnio(anio, totalesQueries[idx].data as YearTotals));
  const acumulado = computeDiferenciaCajaAcumulada(serie, primerArqueo);

  const offsetDelAnioObjetivo = (year - primerArqueo!.anio) * 12;
  const diferenciaPorMes: Record<number, number | null> = {};
  for (const mes of MONTH_IDXS) {
    diferenciaPorMes[mes] = acumulado[offsetDelAnioObjetivo + (mes - 1)];
  }

  return { diferenciaPorMes, isLoading, isError };
}
```

Nota sobre `necesitaTotales`: si `primerArqueoQuery` todavía está cargando o dio error, se evita
lanzar las queries de `fetchYearTotals` de más (`totalesQueries` queda vacío mientras tanto,
`useQueries` con array vacío no dispara ningún fetch) — se resuelven en el siguiente render
cuando `primerArqueoQuery` ya tenga dato.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores (ya no debería haber ningún import de `diferenciaCajaMensual` en el
proyecto — confirmar con `grep -rn "diferenciaCajaMensual" --include="*.ts" --include="*.tsx" .`
que no devuelve resultados fuera de `node_modules`).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-diferencia-caja.ts
git commit -m "feat(dashboard): useDiferenciaCaja orquesta fetch multi-año para el modelo acumulado"
```

---

### Task 4: UI — total anual y textos en `caja-rows.tsx`

**Files:**
- Modify: `components/dashboard/caja-rows.tsx`

**Interfaces:**
- Consumes: `diferenciaPorMes` de `useDiferenciaCaja` (Task 3, sin cambios de forma).
- Produces: nada consumido por otro archivo — es la hoja final de la cadena.

No lleva test unitario dedicado (no hay tests de componentes React en este repo — confirmado,
0 archivos `*.test.tsx`). Se verifica por tipo + build + verificación manual final.

- [ ] **Step 1: Cambiar el cálculo del total anual**

En `components/dashboard/caja-rows.tsx`, reemplazar el bloque de cálculo del total (líneas
192-206 actuales):

```tsx
        {(() => {
          const valores = months.map((mes) => diferenciaPorMes[mes]).filter((v): v is number => v != null);
          const total = valores.length > 0 ? valores.reduce((acc, v) => acc + v, 0) : null;
          const noData = diferenciaLoading || total == null;
          return (
            <ValueCell
              base={TOTAL_TD}
              className={cn("bg-muted font-bold", cardCellClasses("last", "mid"))}
              title="Suma de los meses visibles con arqueo cargado"
              text={diferenciaLoading ? "…" : noData ? "—" : fmtARS(total)}
              negative={!noData && total! < 0}
              gray={noData}
            />
          );
        })()}
```

por:

```tsx
        {(() => {
          // El acumulado ya arrastra el saldo mes a mes — el total anual es el último mes
          // visible con cálculo válido, no una suma (sumar volvería a contar el arrastre).
          let total: number | null = null;
          for (let i = months.length - 1; i >= 0; i--) {
            const v = diferenciaPorMes[months[i]];
            if (v != null) { total = v; break; }
          }
          const noData = diferenciaLoading || total == null;
          return (
            <ValueCell
              base={TOTAL_TD}
              className={cn("bg-muted font-bold", cardCellClasses("last", "mid"))}
              title="Saldo acumulado al último mes con cálculo válido"
              text={diferenciaLoading ? "…" : noData ? "—" : fmtARS(total)}
              negative={!noData && total! < 0}
              gray={noData}
            />
          );
        })()}
```

- [ ] **Step 2: Actualizar el tooltip de la fila y el popover**

Reemplazar el `title` de la línea 146:

```tsx
        <StickyCardCell position="last" bg="bg-muted" className="px-4 py-1.5 whitespace-nowrap font-bold" title="Variación del disponible en caja del mes menos el resultado societario del mes (no acumulado)">
```

por:

```tsx
        <StickyCardCell position="last" bg="bg-muted" className="px-4 py-1.5 whitespace-nowrap font-bold" title="Resultado OP − Ganancia + Disponible en caja, acumulado mes a mes desde el primer arqueo cargado">
```

Reemplazar el contenido del `PopoverContent` (líneas 156-174 actuales):

```tsx
              <PopoverContent className="w-80 p-4 text-xs leading-relaxed text-muted-foreground font-normal">
                <p className="text-[13px] font-semibold text-foreground leading-snug">
                  Diferencia de caja = variación de la caja − (Resultado OP − Ganancia)
                </p>
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-[14px_1fr] gap-x-2 gap-y-2.5">
                  <span className="h-5 flex items-center justify-center" aria-hidden>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: RESULT_COLORS.negative }} />
                  </span>
                  <span><span className="font-medium text-foreground/80">Negativo (falta):</span> gastos que salieron de la caja sin cargar.</span>

                  <span className="h-5 flex items-center justify-center" aria-hidden>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: RESULT_COLORS.positive }} />
                  </span>
                  <span><span className="font-medium text-foreground/80">Positivo (sobra):</span> gastos cargados que no salieron de la caja (deuda).</span>

                  <span className="h-5 flex items-center justify-center font-semibold" style={{ color: RESULT_COLORS.noData }} aria-hidden>—</span>
                  <span><span className="font-medium text-foreground/80">Sin dato:</span> mes de apertura o sin arqueo cargado.</span>
                </div>
              </PopoverContent>
```

por:

```tsx
              <PopoverContent className="w-80 p-4 text-xs leading-relaxed text-muted-foreground font-normal">
                <p className="text-[13px] font-semibold text-foreground leading-snug">
                  Diferencia de caja (mes) = Resultado OP − Ganancia + Disponible en caja
                </p>
                <p className="mt-1.5">
                  Se acumula mes a mes como un resumen bancario, arrancando en el mes siguiente
                  al primer arqueo cargado.
                </p>
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-[14px_1fr] gap-x-2 gap-y-2.5">
                  <span className="h-5 flex items-center justify-center" aria-hidden>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: RESULT_COLORS.negative }} />
                  </span>
                  <span><span className="font-medium text-foreground/80">Negativo (falta):</span> gastos que salieron de la caja sin cargar.</span>

                  <span className="h-5 flex items-center justify-center" aria-hidden>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: RESULT_COLORS.positive }} />
                  </span>
                  <span><span className="font-medium text-foreground/80">Positivo (sobra):</span> gastos cargados que no salieron de la caja (deuda).</span>

                  <span className="h-5 flex items-center justify-center font-semibold" style={{ color: RESULT_COLORS.noData }} aria-hidden>—</span>
                  <span><span className="font-medium text-foreground/80">Sin dato:</span> mes anterior o igual al primer arqueo, o directamente sin ningún arqueo cargado.</span>
                </div>
              </PopoverContent>
```

- [ ] **Step 3: Verificar tipos, lint y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores nuevos.

Run: `npm run build`
Expected: build limpio (corre `prisma generate` antes, no debería fallar por este cambio).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/caja-rows.tsx
git commit -m "feat(dashboard): actualiza total anual y textos de Diferencia de caja al modelo acumulado"
```

---

## Verificación final (no es una task de código — checklist de cierre)

Antes de dar el fix por cerrado:

- [ ] `npx vitest run` completo — sin tests rotos.
- [ ] `npx tsc --noEmit` y `npm run lint` limpios en el estado final de la rama.
- [ ] `npm run build` limpio.
- [ ] **Verificación manual contra datos reales** (obligatoria por CLAUDE.md sección 7 — dato
  financiero de cliente, y porque este fix corrige justamente 3 valores que Diego señaló como
  incorrectos en el dashboard real): cargar el Dashboard de Resultados con un local/PDV y período
  reales, y confirmar que los meses anteriores o iguales al primer arqueo cargado muestran "—",
  que el primer mes posterior al arqueo muestra el primer valor calculado, y que los 3 valores
  que Diego señaló específicamente ya no aparecen como antes. Esto requiere al usuario en la
  sesión (no es algo que el agente pueda verificar solo contra producción sin su confirmación).
- [ ] Actualizar `project_fix_diferencia_caja_spec.md` (memoria) marcando el fix como
  implementado y verificado, una vez confirmado el punto anterior.
