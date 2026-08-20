# Apertura de Gastos — Fase D (Reimportación) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el gap de protección de datos de Apertura de Gastos: reimportar un archivo del ERP recalcula correctamente las compras ya distribuidas cuyo dato cambió, las reglas activas se aplican automáticamente a compras nuevas, y la edición manual sobre una compra distribuida queda bloqueada.

**Architecture:** El ETL (`lib/etl/`) gana una comparación pura de campos ERP (sin conocer nada de apertura) y reporta qué compras ya distribuidas cambiaron. Un orquestador nuevo en `lib/apertura/` reutiliza el motor existente (`aplicarRegla`/`revertirRegla`, ya probado en Fase B/C) para revertir esas compras puntuales y volver a correr todas las reglas activas — mismo camino de código para "compra corregida" y "compra nueva", sin ramas especiales. Un guard nuevo en el endpoint de edición manual cierra el límite #1 de Fase B.

**Tech Stack:** Next.js 16 + Prisma 7 (adapter-pg) + Supabase, TypeScript estricto, Zod, SQL crudo vía `Prisma.sql`/`$queryRaw`/`$executeRaw` (mismo patrón que `motor.ts`/`compras.ts` ya usan), vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-apertura-gastos-design.md` (commit `0f236ce`) — secciones 6 "Reimportación — protección del dato" y 10.3 "Alcance cerrado de Fase D".

## Global Constraints

- Nombres de tabla/columna en español, consistentes con el schema existente (CLAUDE.md sección 1, ya establecido en Fases A/B/C).
- TypeScript estricto, nada de `any` sin justificación en comentario (CLAUDE.md sección 2).
- Ningún error de import/parseo puede fallar en silencio — nunca `catch {}` vacío (CLAUDE.md sección 2, sección 4).
- TDD obligatorio para la capa ETL/import (CLAUDE.md sección 4/9.1) — `camposErpCambiaron` y el diff de `normalizeCompras` llevan test primero. Las funciones de `lib/apertura/` que hacen SQL crudo (`revertirCompra`, `sincronizarTrasImport`) siguen el precedente ya establecido en Fase B/C: sin DB de test separada, sin test de integración automatizado — verificación final controller-direct gateada (Task 9).
- Toda validación de datos externos pasa por Zod con `safeParse` (CLAUDE.md sección 2/8) — no aplica a este plan más allá de lo ya existente (no se tocan schemas Zod).
- Comparación de campos ERP-controlados (sección 6/10.3 del spec, cerrada en brainstorming 20-ago-2026): los 13 campos que hoy se sobreescriben sin condición en el `ON CONFLICT` de `normalizeCompras` — `codCga`, `concepto`, `fecha`, `codigo`, `proveedor`, `detalle`, `observac`, `importe`, `impInt`, `imputac`, `per1`, `per2`, `per3`.
- Cualquier cambio que toque datos de compras/ventas ya importados requiere aprobación explícita antes de ejecutar contra producción (CLAUDE.md sección 7) — Task 9 es la única tarea de este plan que toca datos reales, y está gateada como tal.
- `aplicarRegla`/`revertirRegla`/`revertirCompra` deben llamarse siempre dentro de una `$transaction`, nunca con el export `prisma` a secas (convención ya establecida en `motor.ts`).

---

### Task 1: `camposErpCambiaron` — comparación pura de campos ERP

**Files:**
- Create: `lib/etl/normalizers/compras-diff.ts`
- Modify: `lib/etl/normalizers/compra-identity.ts` (exportar `canonicalDecimal`)
- Test: `lib/etl/normalizers/compras-diff.test.ts`

**Interfaces:**
- Produces: `CompraErpFields` (interface, 13 campos), `camposErpCambiaron(anterior: CompraErpFields, nuevo: CompraErpFields): boolean` — consumidos por Task 2. `canonicalDecimal(raw: string | null): string | null` ahora exportado desde `compra-identity.ts` — consumido por Task 2 para canonicalizar los campos decimal antes de comparar.

- [ ] **Step 1: Escribir los tests**

Crear `lib/etl/normalizers/compras-diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { camposErpCambiaron, type CompraErpFields } from "./compras-diff";

function baseFields(overrides: Partial<CompraErpFields> = {}): CompraErpFields {
  return {
    codCga: "GASTO1",
    concepto: "Alquiler",
    fecha: new Date("2026-03-15T00:00:00.000Z"),
    codigo: "PROV1",
    proveedor: "Juan Perez",
    detalle: "A 0606-00761530",
    observac: "obs",
    importe: "1000",
    impInt: "0",
    imputac: "X",
    per1: "0",
    per2: "0",
    per3: "0",
    ...overrides,
  };
}

describe("camposErpCambiaron", () => {
  it("mismos campos → false", () => {
    expect(camposErpCambiaron(baseFields(), baseFields())).toBe(false);
  });

  it("fecha con el mismo instante pero instancias de Date distintas → false", () => {
    const a = baseFields({ fecha: new Date("2026-03-15T00:00:00.000Z") });
    const b = baseFields({ fecha: new Date("2026-03-15T00:00:00.000Z") });
    expect(camposErpCambiaron(a, b)).toBe(false);
  });

  it("importe distinto → true", () => {
    expect(camposErpCambiaron(baseFields(), baseFields({ importe: "1200" }))).toBe(true);
  });

  it("fecha distinta → true", () => {
    expect(
      camposErpCambiaron(baseFields(), baseFields({ fecha: new Date("2026-04-01T00:00:00.000Z") }))
    ).toBe(true);
  });

  it("campo descriptivo (detalle) distinto → true, aunque importe sea igual", () => {
    expect(camposErpCambiaron(baseFields(), baseFields({ detalle: "otro detalle" }))).toBe(true);
  });

  it("cada uno de los 12 campos string dispara true individualmente (fecha se cubre aparte)", () => {
    const campos: (keyof CompraErpFields)[] = [
      "codCga", "concepto", "codigo", "proveedor", "detalle", "observac",
      "importe", "impInt", "imputac", "per1", "per2", "per3",
    ];
    for (const campo of campos) {
      expect(
        camposErpCambiaron(baseFields(), baseFields({ [campo]: "DISTINTO" } as Partial<CompraErpFields>))
      ).toBe(true);
    }
  });

  it("nulls iguales en ambos lados → false", () => {
    const a = baseFields({ observac: null, proveedor: null });
    const b = baseFields({ observac: null, proveedor: null });
    expect(camposErpCambiaron(a, b)).toBe(false);
  });

  it("un lado null y el otro con valor → true", () => {
    const a = baseFields({ observac: null });
    const b = baseFields({ observac: "algo" });
    expect(camposErpCambiaron(a, b)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr los tests, verificar que fallan**

Run: `npx vitest run lib/etl/normalizers/compras-diff.test.ts`
Expected: FAIL — `Cannot find module './compras-diff'`

- [ ] **Step 3: Exportar `canonicalDecimal` en `compra-identity.ts`**

En `lib/etl/normalizers/compra-identity.ts`, línea 13, cambiar:

```ts
function canonicalDecimal(raw: string | null): string | null {
```

por:

```ts
export function canonicalDecimal(raw: string | null): string | null {
```

- [ ] **Step 4: Implementar `compras-diff.ts`**

Crear `lib/etl/normalizers/compras-diff.ts`:

```ts
export interface CompraErpFields {
  codCga: string | null;
  concepto: string | null;
  fecha: Date | null;
  codigo: string | null;
  proveedor: string | null;
  detalle: string | null;
  observac: string | null;
  importe: string | null; // decimal canónico — ver canonicalDecimal en compra-identity.ts
  impInt: string | null;
  imputac: string | null;
  per1: string | null;
  per2: string | null;
  per3: string | null;
}

function fechaIgual(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

// Compara los 13 campos ERP-controlados de una compra — los mismos que hoy se
// sobreescriben sin condición en el ON CONFLICT de normalizeCompras (ver
// compras.ts). Usada para decidir si una compra ya distribuida necesita
// recalcular sus distribuciones tras una reimportación (spec Apertura de
// Gastos, sección 6/10.3 — "todos los campos ERP-controlados", no solo
// importe). Los campos decimal (importe/impInt/per1/2/3) deben venir ya
// canonicalizados por canonicalDecimal (compra-identity.ts) en ambos lados —
// esta función solo compara, no canonicaliza (evita hacerlo dos veces si el
// caller ya lo hizo para otro propósito, ej. el hash de identidad).
export function camposErpCambiaron(anterior: CompraErpFields, nuevo: CompraErpFields): boolean {
  return (
    anterior.codCga !== nuevo.codCga ||
    anterior.concepto !== nuevo.concepto ||
    !fechaIgual(anterior.fecha, nuevo.fecha) ||
    anterior.codigo !== nuevo.codigo ||
    anterior.proveedor !== nuevo.proveedor ||
    anterior.detalle !== nuevo.detalle ||
    anterior.observac !== nuevo.observac ||
    anterior.importe !== nuevo.importe ||
    anterior.impInt !== nuevo.impInt ||
    anterior.imputac !== nuevo.imputac ||
    anterior.per1 !== nuevo.per1 ||
    anterior.per2 !== nuevo.per2 ||
    anterior.per3 !== nuevo.per3
  );
}
```

- [ ] **Step 5: Correr los tests, verificar que pasan**

Run: `npx vitest run lib/etl/normalizers/compras-diff.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: Correr la suite completa de ETL para confirmar que exportar `canonicalDecimal` no rompió nada**

Run: `npx vitest run lib/etl/`
Expected: PASS, mismo conteo que antes de este task + los 9 tests nuevos.

- [ ] **Step 7: Commit**

```bash
git add lib/etl/normalizers/compras-diff.ts lib/etl/normalizers/compras-diff.test.ts lib/etl/normalizers/compra-identity.ts
git commit -m "feat(apertura-gastos): agrega camposErpCambiaron para detectar cambios ERP en compras distribuidas"
```

---

### Task 2: `normalizeCompras` — detectar compras distribuidas modificadas

**Files:**
- Modify: `lib/etl/normalizers/compras.ts`
- Modify: `lib/etl/types.ts` (`ETLReport`)
- Modify: `lib/etl/run-etl.ts` (`NormalizerFn`, threading)
- Test: `lib/etl/normalizers/compras.test.ts`

**Interfaces:**
- Consumes: `camposErpCambiaron`, `CompraErpFields` (Task 1, `./compras-diff`), `canonicalDecimal` (Task 1, `./compra-identity`).
- Produces: `normalizeCompras(...)` ahora devuelve también `comprasDistribuidasModificadas: string[]`. `ETLReport` gana el campo opcional `comprasDistribuidasModificadas?: string[]` — consumido por Task 5.

- [ ] **Step 1: Escribir los tests**

Agregar al final de `lib/etl/normalizers/compras.test.ts` (mismo archivo, después de los tests existentes — no tocar los de arriba):

```ts
import { excelDateToISO } from "../helpers";

// ... (dentro del mismo describe("normalizeCompras", ...) ya existente, agregar:)

it("compra existente esDistribuido=true con importe idéntico → comprasDistribuidasModificadas vacío", async () => {
  const fechaEsperada = new Date(excelDateToISO(45000)!);
  const db = createMockDb({
    compra: {
      findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
        const ids = args?.where?.rowId?.in ?? [];
        return ids.map((rowId) => ({
          rowId,
          esDistribuido: true,
          codCga: "GASTO1", concepto: "Alquiler", fecha: fechaEsperada,
          codigo: "PROV1", proveedor: "Juan Perez", detalle: "A 0606-00761530", observac: "obs",
          importe: { toString: () => "1000" }, impInt: { toString: () => "0" }, imputac: "X",
          per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
        }));
      }),
    },
  });
  const res = await normalizeCompras([baseRow()], db);
  expect(res.comprasDistribuidasModificadas).toEqual([]);
});

it("compra existente esDistribuido=true con importe distinto → aparece en comprasDistribuidasModificadas", async () => {
  const fechaEsperada = new Date(excelDateToISO(45000)!);
  const db = createMockDb({
    compra: {
      findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
        const ids = args?.where?.rowId?.in ?? [];
        return ids.map((rowId) => ({
          rowId,
          esDistribuido: true,
          codCga: "GASTO1", concepto: "Alquiler", fecha: fechaEsperada,
          codigo: "PROV1", proveedor: "Juan Perez", detalle: "A 0606-00761530", observac: "obs",
          importe: { toString: () => "1000" }, impInt: { toString: () => "0" }, imputac: "X",
          per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
        }));
      }),
    },
  });
  const res = await normalizeCompras([baseRow({ IMPORTE: 1200 })], db);
  expect(res.comprasDistribuidasModificadas).toHaveLength(1);
});

it("compra existente esDistribuido=false → nunca entra a comprasDistribuidasModificadas aunque cambie el importe", async () => {
  const fechaEsperada = new Date(excelDateToISO(45000)!);
  const db = createMockDb({
    compra: {
      findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
        const ids = args?.where?.rowId?.in ?? [];
        return ids.map((rowId) => ({
          rowId,
          esDistribuido: false,
          codCga: "GASTO1", concepto: "Alquiler", fecha: fechaEsperada,
          codigo: "PROV1", proveedor: "Juan Perez", detalle: "A 0606-00761530", observac: "obs",
          importe: { toString: () => "1000" }, impInt: { toString: () => "0" }, imputac: "X",
          per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
        }));
      }),
    },
  });
  const res = await normalizeCompras([baseRow({ IMPORTE: 1200 })], db);
  expect(res.comprasDistribuidasModificadas).toEqual([]);
});

it("compra nueva (no existía) → nunca entra a comprasDistribuidasModificadas", async () => {
  const db = createMockDb(); // findMany devuelve [] por defecto — nada existe
  const res = await normalizeCompras([baseRow()], db);
  expect(res.comprasDistribuidasModificadas).toEqual([]);
});
```

- [ ] **Step 2: Correr los tests, verificar que fallan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: FAIL — `res.comprasDistribuidasModificadas` es `undefined`, no `[]`/`toHaveLength(1)`.

- [ ] **Step 3: Modificar `lib/etl/normalizers/compras.ts`**

Agregar los imports (después de la línea 7 existente):

```ts
import { camposErpCambiaron, type CompraErpFields } from "./compras-diff";
import { canonicalDecimal } from "./compra-identity";
```

Agregar dos funciones adaptadoras antes de `normalizeCompras` (después de `makeRowId`, línea 28):

```ts
function erpFieldsDesdeDatoParseado(data: CompraRow): CompraErpFields {
  return {
    codCga: data.COD_CGA,
    concepto: data.CONCEPTO,
    fecha: data.FECHA,
    codigo: data.CODIGO,
    proveedor: data.PROVEEDOR,
    detalle: data.DETALLE,
    observac: data.OBSERVAC,
    importe: canonicalDecimal(data.IMPORTE),
    impInt: canonicalDecimal(data.IMP_INT),
    imputac: data.IMPUTAC,
    per1: canonicalDecimal(data.PER1),
    per2: canonicalDecimal(data.PER2),
    per3: canonicalDecimal(data.PER3),
  };
}

interface CompraExistenteRow {
  rowId: string;
  esDistribuido: boolean;
  codCga: string | null;
  concepto: string | null;
  fecha: Date | null;
  codigo: string | null;
  proveedor: string | null;
  detalle: string | null;
  observac: string | null;
  importe: { toString(): string } | null;
  impInt: { toString(): string } | null;
  imputac: string | null;
  per1: { toString(): string } | null;
  per2: { toString(): string } | null;
  per3: { toString(): string } | null;
}

function erpFieldsDesdeCompraExistente(row: CompraExistenteRow): CompraErpFields {
  return {
    codCga: row.codCga,
    concepto: row.concepto,
    fecha: row.fecha,
    codigo: row.codigo,
    proveedor: row.proveedor,
    detalle: row.detalle,
    observac: row.observac,
    importe: canonicalDecimal(row.importe != null ? row.importe.toString() : null),
    impInt: canonicalDecimal(row.impInt != null ? row.impInt.toString() : null),
    imputac: row.imputac,
    per1: canonicalDecimal(row.per1 != null ? row.per1.toString() : null),
    per2: canonicalDecimal(row.per2 != null ? row.per2.toString() : null),
    per3: canonicalDecimal(row.per3 != null ? row.per3.toString() : null),
  };
}
```

Cambiar la firma de retorno de `normalizeCompras` (línea 30-34) de:

```ts
export async function normalizeCompras(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; skippedRows: ETLSkippedRow[]; errors: ETLRowError[] }> {
```

a:

```ts
export async function normalizeCompras(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  skippedRows: ETLSkippedRow[];
  errors: ETLRowError[];
  comprasDistribuidasModificadas: string[];
}> {
```

Declarar el acumulador junto a `created`/`updated` (línea 115-116):

```ts
  let created = 0;
  let updated = 0;
  const comprasDistribuidasModificadas: string[] = [];
```

Reemplazar el bloque `existingSet` (líneas 122-127 del archivo original) de:

```ts
    const existingSet = new Set(
      (await prisma.compra.findMany({
        where: { rowId: { in: chunkRowIds } },
        select: { rowId: true },
      })).map((c) => c.rowId)
    );
```

a:

```ts
    const existingRows = await prisma.compra.findMany({
      where: { rowId: { in: chunkRowIds } },
      select: {
        rowId: true, esDistribuido: true,
        codCga: true, concepto: true, fecha: true, codigo: true, proveedor: true,
        detalle: true, observac: true, importe: true, impInt: true, imputac: true,
        per1: true, per2: true, per3: true,
      },
    });
    const existingMap = new Map(existingRows.map((r) => [r.rowId, r]));
```

Reemplazar el loop de conteo al final del `try` (líneas 190-192 del archivo original) de:

```ts
      for (const rowId of chunkRowIds) {
        if (existingSet.has(rowId)) updated++; else created++;
      }
```

a:

```ts
      for (const { rowId, data } of chunk) {
        const oldRow = existingMap.get(rowId);
        if (oldRow) updated++; else created++;
        if (oldRow?.esDistribuido && camposErpCambiaron(erpFieldsDesdeCompraExistente(oldRow), erpFieldsDesdeDatoParseado(data))) {
          comprasDistribuidasModificadas.push(rowId);
        }
      }
```

Agregar `comprasDistribuidasModificadas` al `return` final de la función (línea 206 del archivo original):

```ts
  return { created, updated, skipped, skippedRows, errors, comprasDistribuidasModificadas };
```

- [ ] **Step 4: Correr los tests, verificar que pasan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: PASS (todos los tests existentes + los 4 nuevos)

- [ ] **Step 5: Actualizar `lib/etl/types.ts`**

En `ETLReport` (líneas 41-51), agregar el campo después de `errors`:

```ts
export interface ETLReport {
  fileType: ETLFileType;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  skippedRows?: ETLSkippedRow[];
  errors: ETLRowError[];
  comprasDistribuidasModificadas?: string[];
  durationMs: number;
  storagePath?: string;
}
```

- [ ] **Step 6: Actualizar `lib/etl/run-etl.ts`**

Cambiar el tipo `NormalizerFn` (líneas 15-19) de:

```ts
type NormalizerFn = (
  rows: ETLRow[],
  db: DbClient,
  ctx?: ETLContext
) => Promise<{ created: number; updated: number; skipped: number; skippedRows?: ETLSkippedRow[]; errors: ETLRowError[] }>;
```

a:

```ts
type NormalizerFn = (
  rows: ETLRow[],
  db: DbClient,
  ctx?: ETLContext
) => Promise<{
  created: number;
  updated: number;
  skipped: number;
  skippedRows?: ETLSkippedRow[];
  errors: ETLRowError[];
  comprasDistribuidasModificadas?: string[];
}>;
```

Cambiar la destructuración y el `return` de `runETL` (líneas 55-67) de:

```ts
  const { created, updated, skipped, skippedRows, errors } = await normalizer(rows, client, ctx);

  return {
    fileType,
    totalRows: rows.length,
    created,
    updated,
    skipped,
    skippedRows,
    errors,
    durationMs: Date.now() - startMs,
    storagePath,
  };
```

a:

```ts
  const { created, updated, skipped, skippedRows, errors, comprasDistribuidasModificadas } = await normalizer(rows, client, ctx);

  return {
    fileType,
    totalRows: rows.length,
    created,
    updated,
    skipped,
    skippedRows,
    errors,
    comprasDistribuidasModificadas,
    durationMs: Date.now() - startMs,
    storagePath,
  };
```

- [ ] **Step 7: Correr la suite completa de ETL + typecheck**

Run: `npx vitest run lib/etl/`
Expected: PASS, todos los tests (incluidos los normalizers de rubros/articulos/etc, que ahora devuelven un objeto SIN `comprasDistribuidasModificadas` pero siguen siendo asignables a `NormalizerFn` por ser un campo opcional).

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add lib/etl/normalizers/compras.ts lib/etl/normalizers/compras.test.ts lib/etl/types.ts lib/etl/run-etl.ts
git commit -m "feat(apertura-gastos): normalizeCompras detecta compras distribuidas con campos ERP modificados"
```

---

### Task 3: `revertirCompra` — reversión de una sola compra

**Files:**
- Modify: `lib/apertura/motor.ts`

**Interfaces:**
- Consumes: `AperturaDbClient` (ya definido en `motor.ts`).
- Produces: `revertirCompra(prisma: AperturaDbClient, rowId: string): Promise<void>` — consumido por Task 4.

Sin test automatizado — mismo criterio ya establecido en Fase B/C para `aplicarRegla`/`revertirRegla` (SQL crudo, sin DB de test separada, CLAUDE.md sección 4 nota de excepción documentada en memoria del proyecto). Cubierto por revisión de código y por la verificación final controller-direct de Task 9.

- [ ] **Step 1: Implementar `revertirCompra`**

Agregar al final de `lib/apertura/motor.ts`, después de `revertirRegla` (línea 208):

```ts

// Revierte la distribución de UNA sola compra (no toda una regla): borra sus
// filas de distribuciones_apertura y la deja esDistribuido = false. Usada por
// sincronizarTrasImport (lib/apertura/reimportacion.ts) cuando una compra ya
// distribuida cambió en el ERP — revertir y dejar que la misma pasada de
// matching la vuelva a tomar es más simple que un recalculo dirigido, y es el
// mismo camino de código sin importar qué campo cambió (Fase D, diseño
// técnico sección 6).
//
// IMPORTANTE: igual que aplicarRegla/revertirRegla, debe llamarse SIEMPRE
// dentro de una $transaction — nunca con el `prisma` export a secas.
export async function revertirCompra(prisma: AperturaDbClient, rowId: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`DELETE FROM distribuciones_apertura WHERE "compraRowId" = ${rowId}`);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras SET "esDistribuido" = false, "distribuidoEn" = null WHERE "rowId" = ${rowId}
  `);
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add lib/apertura/motor.ts
git commit -m "feat(apertura-gastos): agrega revertirCompra para reversión puntual de una compra"
```

---

### Task 4: `sincronizarTrasImport` — orquestador post-import

**Files:**
- Create: `lib/apertura/reimportacion.ts`

**Interfaces:**
- Consumes: `revertirCompra`, `aplicarRegla` (Task 3 y ya existentes en `motor.ts`), `ReglaVigencia` (`./vigencia`).
- Produces: `sincronizarTrasImport(prisma: PrismaClient, comprasModificadas: string[]): Promise<{ comprasRecalculadas: number; reglasReaplicadas: number; errores: string[] }>` — consumido por Task 5.

Sin test automatizado — mismo criterio que Task 3 (orquestación sobre `$transaction`+SQL crudo). Cubierto por Task 9.

- [ ] **Step 1: Implementar `lib/apertura/reimportacion.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { aplicarRegla, revertirCompra } from "./motor";
import type { ReglaVigencia } from "./vigencia";

export interface SincronizarTrasImportResultado {
  comprasRecalculadas: number;
  reglasReaplicadas: number;
  errores: string[];
}

// Corre al final de cada import de compras (app/api/etl/drive-import/route.ts,
// después de que TODOS los archivos del batch ya commitearon). Dos pasos, un
// solo camino de código para "compra corregida" y "compra nueva" (Fase D,
// diseño técnico sección 6):
//
// 1. Cada compra en `comprasModificadas` (ya distribuida, con algún campo ERP
//    cambiado — ver camposErpCambiaron en lib/etl/normalizers/compras-diff.ts)
//    se revierte: queda esDistribuido = false, disponible para el paso 2.
// 2. aplicarRegla se vuelve a correr para TODAS las reglas activas. Es
//    idempotente por diseño (solo toca compras con esDistribuido = false), así
//    que agarra en la misma pasada tanto las compras recién revertidas como
//    cualquier compra genuinamente nueva del batch que caiga en el período de
//    una regla activa — sin necesidad de rastrear qué conceptos tocó el
//    import (ver "por qué no filtrar por concepto tocado" en la sección 10.3
//    del diseño: con el volumen esperado de reglas activas, filtrar sería una
//    optimización prematura que acopla más el ETL a apertura).
//
// Cada compra revertida y cada regla reaplicada corre en su propia
// $transaction — un fallo puntual no aborta el resto del batch, se acumula en
// `errores` (nunca se traga en silencio, CLAUDE.md sección 2).
export async function sincronizarTrasImport(
  prisma: PrismaClient,
  comprasModificadas: string[]
): Promise<SincronizarTrasImportResultado> {
  const errores: string[] = [];
  let comprasRecalculadas = 0;

  for (const rowId of comprasModificadas) {
    try {
      await prisma.$transaction(async (tx) => {
        await revertirCompra(tx, rowId);
      });
      comprasRecalculadas++;
    } catch (err) {
      errores.push(`revertirCompra(${rowId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const reglasActivas = await prisma.reglaApertura.findMany({
    where: { estado: "activa" },
    include: { destinos: true },
  });

  let reglasReaplicadas = 0;
  for (const regla of reglasActivas) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const vigencia: ReglaVigencia = {
            modo: regla.modo as ReglaVigencia["modo"],
            fechaDesde: regla.fechaDesde,
            fechaHasta: regla.fechaHasta,
            extremosInclusivos: regla.extremosInclusivos,
          };
          await aplicarRegla(tx, {
            reglaId: regla.id,
            entidadId: regla.entidadId,
            vigencia,
            destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
          });
        },
        { timeout: 55000 }
      );
      reglasReaplicadas++;
    } catch (err) {
      errores.push(`aplicarRegla(regla #${regla.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { comprasRecalculadas, reglasReaplicadas, errores };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add lib/apertura/reimportacion.ts
git commit -m "feat(apertura-gastos): agrega sincronizarTrasImport, orquestador de reimportación"
```

---

### Task 5: Wiring en `drive-import` + respuesta al frontend

**Files:**
- Modify: `app/api/etl/drive-import/route.ts`
- Modify: `hooks/use-drive-import.ts`
- Modify: `lib/toast.ts`

**Interfaces:**
- Consumes: `sincronizarTrasImport` (Task 4), `ETLReport.comprasDistribuidasModificadas` (Task 2).
- Produces: la respuesta de `POST /api/etl/drive-import` cambia de `ETLReport[]` (array plano) a `{ reports: ETLReport[]; apertura: SincronizarTrasImportResultado }` — es un cambio de forma que rompe al único consumidor actual (`use-drive-import.ts`), corregido en este mismo task.

- [ ] **Step 1: Agregar el toast de errores de sincronización**

En `lib/toast.ts`, agregar al objeto `notify` (después de `localNoReconocido`, antes del cierre `};`):

```ts

  aperturaSincronizacionConErrores: (count: number) =>
    toast.warning("Apertura de gastos — sincronización con errores", {
      description: `${count} error${count !== 1 ? "es" : ""} al recalcular/aplicar reglas de apertura tras el import — revisá los detalles en el servidor`,
      duration: Infinity,
      closeButton: true,
    }),
```

- [ ] **Step 2: Wiring en `app/api/etl/drive-import/route.ts`**

Agregar el import (después de la línea 10 existente):

```ts
import { sincronizarTrasImport } from "@/lib/apertura/reimportacion";
```

Reemplazar el bloque final (líneas 193-196 del archivo original) de:

```ts
    // Link detalle_compras → compras post-batch
    await linkDetalleCompras(getEtlClient() as unknown as DbClient, localId);

    return NextResponse.json(reports);
```

a:

```ts
    // Link detalle_compras → compras post-batch
    await linkDetalleCompras(getEtlClient() as unknown as DbClient, localId);

    // Apertura de Gastos (Fase D): compras ya distribuidas cuyos campos ERP
    // cambiaron se revierten y re-matchean contra las reglas activas, en la
    // misma pasada que también auto-aplica reglas activas a compras nuevas
    // que hayan llegado en este batch. Ver diseño técnico sección 6.
    const comprasModificadas = reports.flatMap((r) => r.comprasDistribuidasModificadas ?? []);
    const apertura = await sincronizarTrasImport(getEtlClient(), comprasModificadas);

    return NextResponse.json({ reports, apertura });
```

- [ ] **Step 3: Actualizar `hooks/use-drive-import.ts`**

Reemplazar el bloque de parseo de respuesta (líneas 54-69 del archivo original) de:

```ts
      const json = await res.json();
      if (!res.ok) {
        setFileStatuses((s) => ({ ...s, [file.id]: "error" }));
        setFileErrors((s) => ({ ...s, [file.id]: json.error ?? "Error" }));
        return { ok: false, records: 0 };
      } else if (Array.isArray(json)) {
        const reports = json as ETLReport[];
        setFileStatuses((s) => ({ ...s, [file.id]: "success" }));
        setFileReports((s) => ({ ...s, [file.id]: reports }));
        const records = reports.reduce((s, r) => s + r.created + r.updated, 0);
        return { ok: true, records };
      } else {
        setFileStatuses((s) => ({ ...s, [file.id]: "error" }));
        setFileErrors((s) => ({ ...s, [file.id]: "Respuesta inesperada del servidor" }));
        return { ok: false, records: 0 };
      }
```

a:

```ts
      const json = await res.json();
      if (!res.ok) {
        setFileStatuses((s) => ({ ...s, [file.id]: "error" }));
        setFileErrors((s) => ({ ...s, [file.id]: json.error ?? "Error" }));
        return { ok: false, records: 0 };
      } else if (json && Array.isArray(json.reports)) {
        const reports = json.reports as ETLReport[];
        setFileStatuses((s) => ({ ...s, [file.id]: "success" }));
        setFileReports((s) => ({ ...s, [file.id]: reports }));
        const erroresApertura: string[] = json.apertura?.errores ?? [];
        if (erroresApertura.length > 0) {
          notify.aperturaSincronizacionConErrores(erroresApertura.length);
        }
        const records = reports.reduce((s, r) => s + r.created + r.updated, 0);
        return { ok: true, records };
      } else {
        setFileStatuses((s) => ({ ...s, [file.id]: "error" }));
        setFileErrors((s) => ({ ...s, [file.id]: "Respuesta inesperada del servidor" }));
        return { ok: false, records: 0 };
      }
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add app/api/etl/drive-import/route.ts hooks/use-drive-import.ts lib/toast.ts
git commit -m "feat(apertura-gastos): sincroniza apertura de gastos tras cada import de compras"
```

---

### Task 6: Guard 409 en edición manual de compra distribuida

**Files:**
- Modify: `app/api/dashboard/compras/[rowId]/route.ts`

**Interfaces:**
- Consumes: campo `esDistribuido` de `Compra` (ya existe en el schema desde Fase A).

- [ ] **Step 1: Agregar el guard**

En `app/api/dashboard/compras/[rowId]/route.ts`, reemplazar el bloque `try` (líneas 32-50 del archivo original) de:

```ts
  try {
    const updated = await prisma.compra.update({
      where: { rowId },
      data: {
        ...(importeManual !== undefined && { importeManual }),
        ...(fechaManual !== undefined && { fechaManual: fechaManual !== null ? new Date(fechaManual) : null }),
        ...(conceptoCodigoManual !== undefined && { conceptoCodigoManual }),
        ...(observacManual !== undefined && { observacManual }),
      },
      select: { rowId: true, importeManual: true, fechaManual: true, conceptoCodigoManual: true, observacManual: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
      if (err.code === "P2003") return NextResponse.json({ error: "Concepto no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
```

a:

```ts
  const compra = await prisma.compra.findUnique({ where: { rowId }, select: { esDistribuido: true } });
  if (!compra) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
  if (compra.esDistribuido) {
    return NextResponse.json(
      {
        error:
          "Esta compra está distribuida por una regla de apertura de gastos. Para corregirla, editá o revertí la regla en vez de editar la compra.",
      },
      { status: 409 }
    );
  }

  try {
    const updated = await prisma.compra.update({
      where: { rowId },
      data: {
        ...(importeManual !== undefined && { importeManual }),
        ...(fechaManual !== undefined && { fechaManual: fechaManual !== null ? new Date(fechaManual) : null }),
        ...(conceptoCodigoManual !== undefined && { conceptoCodigoManual }),
        ...(observacManual !== undefined && { observacManual }),
      },
      select: { rowId: true, importeManual: true, fechaManual: true, conceptoCodigoManual: true, observacManual: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
      if (err.code === "P2003") return NextResponse.json({ error: "Concepto no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
```

El guard es todo-o-nada: se aplica sin importar qué combinación de `importeManual`/`fechaManual`/`conceptoCodigoManual`/`observacManual` venga en el body (los tres primeros son justamente los que rompían la vista distribuida o desenganchaban la compra en silencio — sección 6 del diseño técnico).

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add app/api/dashboard/compras/\[rowId\]/route.ts
git commit -m "fix(apertura-gastos): bloquea edición manual de compras ya distribuidas"
```

---

### Task 7: `esDistribuido` en `detalle` — cierra el gap de UI

**Files:**
- Modify: `app/api/dashboard/detalle/route.ts`
- Modify: `lib/dashboard/types.ts` (`CompraDetalle`)

**Interfaces:**
- Produces: `CompraDetalle.esDistribuido: boolean` — consumido por Task 8.

- [ ] **Step 1: Agregar el campo al tipo**

En `lib/dashboard/types.ts`, en `CompraDetalle` (línea 135), agregar después de `distribucionId: number | null;`:

```ts
  esDistribuido: boolean;
```

- [ ] **Step 2: Branch `(a)` — con `distribucionId` (fila de fan-out, siempre distribuida)**

En `app/api/dashboard/detalle/route.ts`, en el objeto devuelto del branch `(a)` (líneas 129-155 del archivo original), agregar `esDistribuido: true` — por ejemplo después de `distribucionId: distribucion.id,` (línea 133):

```ts
            distribucionId: distribucion.id,
            esDistribuido: true,
```

- [ ] **Step 3: Branch `(b)` — sin `distribucionId` (compra puntual completa)**

Agregar `esDistribuido: true` al `select` de `prisma.compra.findUnique` (líneas 161-181 del archivo original), después de `rowId: true,`:

```ts
        rowId: true,
        esDistribuido: true,
```

El objeto de respuesta (línea 182) ya hace spread de `compra` (`{ ...compra, distribucionId: null }`), así que `esDistribuido` viaja automáticamente sin más cambios ahí.

- [ ] **Step 4: Lista completa (sin `rowId`) — derivar desde `distribucionId`**

`v_compras_distribuidas` no expone una columna `esDistribuido` propia, pero `distribucionId IS NOT NULL` es exactamente equivalente por construcción de la vista (una fila de fan-out siempre tiene `distribucionId`, una fila passthrough nunca lo tiene — diseño técnico sección 4). Agregar la columna calculada al SELECT (después de `c."distribucionId",`, línea 232 del archivo original):

```sql
        c."distribucionId",
        (c."distribucionId" IS NOT NULL) AS "esDistribuido",
```

Agregar el campo a `DetalleSqlRow` (después de `distribucionId: number | null;`, línea 13):

```ts
  esDistribuido: boolean;
```

Agregar el campo al `return` de `reshapeDetalle` (después de `distribucionId: r.distribucionId,`, línea 47):

```ts
    esDistribuido: r.esDistribuido,
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add app/api/dashboard/detalle/route.ts lib/dashboard/types.ts
git commit -m "feat(apertura-gastos): expone esDistribuido en /api/dashboard/detalle"
```

---

### Task 8: Deshabilitar edición en `compras-detalle-modal.tsx`

**Files:**
- Modify: `components/dashboard/compras-detalle-modal.tsx`

**Interfaces:**
- Consumes: `CompraDetalle.esDistribuido` (Task 7).

La condición que hoy deshabilita "Ver líneas"/Editar solo cubre `item.distribucionId != null` (filas de fan-out, agregado en Fase C). Falta el caso de la fila "raíz": una compra completa (`distribucionId === null`) que en realidad ya está distribuida — el único camino real hoy es a través del branch `(b)` de `detalle/route.ts` (Task 7), que siempre devolvía `distribucionId: null` sin importar el estado real de la compra.

- [ ] **Step 1: "Ver líneas" (línea 303 del archivo original)**

Cambiar:

```tsx
        ) : item.distribucionId == null ? (
```

a:

```tsx
        ) : item.distribucionId == null && !item.esDistribuido ? (
```

- [ ] **Step 2: Editar (línea 328 del archivo original)**

Cambiar:

```tsx
        {item.distribucionId == null ? (
```

a:

```tsx
        {item.distribucionId == null && !item.esDistribuido ? (
```

- [ ] **Step 3: Actualizar el tooltip del botón Editar deshabilitado**

En el mismo bloque (línea 350 del archivo original), el tooltip dice "No se puede editar una porción distribuida todavía — editá la compra completa antes de aperturarla." — ese texto asume que siempre se llega ahí por ser una porción (`distribucionId != null`). Como ahora también cubre la compra completa ya distribuida, cambiar el texto a uno válido para ambos casos:

```tsx
            <TooltipContent>Esta compra está distribuida por una regla de apertura de gastos — editá o revertí la regla en vez de editar la compra.</TooltipContent>
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 5: Verificación manual en dev server**

Run: `npm run dev`, abrir el dashboard, confirmar que la tabla de compras sigue renderizando sin errores de consola y que las filas normales (no distribuidas) siguen mostrando Editar/Ver líneas habilitados. No hay ninguna regla activa en esta etapa (Task 9 todavía no corrió), así que no hay filas distribuidas reales para probar el disable visualmente — eso se confirma en Task 9.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/compras-detalle-modal.tsx
git commit -m "fix(apertura-gastos): deshabilita edición de compras distribuidas sin fan-out visible"
```

---

### Task 9: Verificación final contra producción (gateada, controller-direct)

**⚠️ Esta tarea toca datos reales de compras en producción. Ejecutar SOLO con aprobación explícita del usuario en el momento (CLAUDE.md sección 7) — no vía subagent, directamente el controller (CLAUDE.md sección 9.1, excepción de `subagent-driven-development`/`dispatching-parallel-agents` para datos de compras/ventas).**

**Files:**
- Create (temporal, no commitear): `scripts/_tmp_task9_verify.ts`

Sin test automatizado — motor.ts/reimportacion.ts no tienen DB de test separada (mismo límite ya documentado en Fase B/C). Esta tarea es la cobertura real de `revertirCompra`/`sincronizarTrasImport`/el guard del PATCH, ejecutada contra datos reales de bajo riesgo con reversión completa al final.

- [ ] **Step 1: Backup manual**

```bash
pg_dump "$DIRECT_URL" --schema=public --no-owner --no-privileges > backups/pre-apertura-fase-d-$(date +%Y%m%d%H%M%S).sql
```

Confirmar que el archivo se generó y no está vacío antes de seguir.

- [ ] **Step 2: Crear un script descartable de verificación**

Crear `scripts/_tmp_task9_verify.ts` (mismo patrón que los scripts descartables de Fase B/C — `getEtlClient()`, imports relativos, subcomandos por `process.argv`):

```ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { getEtlClient } from "../lib/etl/etl-client";
import { normalizeCompras } from "../lib/etl/normalizers/compras";
import { sincronizarTrasImport } from "../lib/apertura/reimportacion";
import { resolverLocalIdDestinos, aplicarRegla, revertirRegla } from "../lib/apertura/motor";
import type { ReglaVigencia } from "../lib/apertura/vigencia";
import type { ETLRow, DbClient } from "../lib/etl/types";

const prisma = getEtlClient();
const CONCEPTO_PRUEBA = "913"; // "Mantenimiento Vidrios" — mismo concepto de bajo riesgo ya usado en Fase B/C

async function estado() {
  const compras = await prisma.$queryRawUnsafe<{ rowId: string; importe: string; esDistribuido: boolean }[]>(
    `SELECT "rowId", importe::text, "esDistribuido" FROM compras WHERE "conceptoCodigo" = '${CONCEPTO_PRUEBA}' ORDER BY fecha`
  );
  console.log(JSON.stringify(compras, null, 2));
  const reglas = await prisma.reglaApertura.findMany({ where: { entidadId: CONCEPTO_PRUEBA }, include: { destinos: true } });
  console.log(JSON.stringify(reglas, null, 2));
}

async function crearReglaPrueba() {
  const localesRamos = await prisma.local.findFirst({ where: { nombre: { contains: "Ramos" } } });
  if (!localesRamos) throw new Error("No se encontró el local Ramos Mejía");
  const vigencia: ReglaVigencia = { modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
  const { regla, comprasAfectadas } = await prisma.$transaction(async (tx) => {
    const destinos = await resolverLocalIdDestinos(tx, [{ localId: localesRamos.id, puntoDeVentaId: null, porcentaje: 100 }]);
    const regla = await tx.reglaApertura.create({
      data: {
        nivel: "concepto", entidadId: CONCEPTO_PRUEBA, modo: "historico", extremosInclusivos: true,
        creadoPor: "task9-verify-fase-d",
        destinos: { create: destinos.map((d) => ({ localId: d.localId, puntoDeVentaId: d.puntoDeVentaId, porcentaje: d.porcentaje })) },
      },
      include: { destinos: true },
    });
    const resultado = await aplicarRegla(tx, {
      reglaId: regla.id, entidadId: CONCEPTO_PRUEBA, vigencia,
      destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
    });
    return { regla, comprasAfectadas: resultado.comprasAfectadas };
  });
  console.log("Regla creada:", regla.id, "comprasAfectadas:", comprasAfectadas);
}

// Simula la reimportación de UNA compra ya distribuida con un importe distinto.
// row: fila cruda del "Excel" (mismos nombres de columna que usa compraRowSchema).
async function reimportarFilaModificada(row: ETLRow) {
  const res = await normalizeCompras([row], prisma as unknown as DbClient);
  console.log("normalizeCompras:", JSON.stringify({ created: res.created, updated: res.updated, comprasDistribuidasModificadas: res.comprasDistribuidasModificadas }, null, 2));
  const sync = await sincronizarTrasImport(prisma, res.comprasDistribuidasModificadas);
  console.log("sincronizarTrasImport:", JSON.stringify(sync, null, 2));
}

async function revertirTodo() {
  const reglas = await prisma.reglaApertura.findMany({ where: { entidadId: CONCEPTO_PRUEBA } });
  for (const regla of reglas) {
    await prisma.$transaction(async (tx) => {
      await revertirRegla(tx, regla.id);
      await tx.destinoRegla.deleteMany({ where: { reglaId: regla.id } });
      await tx.reglaApertura.delete({ where: { id: regla.id } });
    });
    console.log("Regla revertida y eliminada:", regla.id);
  }
}

const cmd = process.argv[2];
const run = { estado, "crear-regla": crearReglaPrueba, revertir: revertirTodo }[cmd];
if (run) {
  run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else if (cmd === "reimportar") {
  const fila: ETLRow = JSON.parse(process.argv[3]);
  reimportarFilaModificada(fila).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.error("Uso: tsx scripts/_tmp_task9_verify.ts <estado|crear-regla|reimportar '<json-fila>'|revertir>");
  process.exit(1);
}
```

- [ ] **Step 3: Estado inicial**

```bash
npx tsx scripts/_tmp_task9_verify.ts estado
```

Anotar: cuántas compras tiene el concepto `913`, sus `rowId`/`importe`, y confirmar 0 reglas existentes para ese concepto (mismo punto de partida que las verificaciones de Fase B/C, que ya revirtieron completo al terminar).

- [ ] **Step 4: Crear la regla de prueba y confirmar aplicación**

```bash
npx tsx scripts/_tmp_task9_verify.ts crear-regla
npx tsx scripts/_tmp_task9_verify.ts estado
```

Confirmar: la/las compra(s) del concepto quedan `esDistribuido = true`, con una distribución 100% al local Ramos Mejía.

- [ ] **Step 5: Simular una reimportación que MODIFICA el importe de la compra ya distribuida**

Tomar el `rowId` anotado en el Step 3/4, reconstruir la fila "Excel" original con el mismo `COD_CGA`/`FECHA`/`CODIGO`/`CONCEPTO`/`DETALLE`/`PROVEEDOR`/`OBSERVAC`/`IMPUTAC`/`PER1`/`PER2`/`PER3` que ya tiene esa compra en la base (consultar con `estado` o directo en la base), pero con `IMPORTE` distinto (ej. el original + $500). Ejemplo con importe original $8.500 → nuevo $9.000:

```bash
npx tsx scripts/_tmp_task9_verify.ts reimportar '{"COD_CGA":"913","FECHA":45000,"CODIGO":null,"CONCEPTO":"Mantenimiento Vidrios","DETALLE":null,"PROVEEDOR":null,"OBSERVAC":null,"IMPORTE":9000,"IMP_INT":0,"IMPUTAC":null,"PER1":0,"PER2":0,"PER3":0}'
```

(Ajustar `FECHA`/`DETALLE`/`PROVEEDOR`/`OBSERVAC`/`IMPUTAC` a los valores REALES de la compra elegida — deben coincidir exactamente con lo ya persistido, salvo `IMPORTE`, para que el `rowId` calculado sea el mismo y el `ON CONFLICT` actualice el registro existente en vez de crear uno nuevo.)

Confirmar en el output: `normalizeCompras.comprasDistribuidasModificadas` contiene el `rowId`; `sincronizarTrasImport.comprasRecalculadas === 1`, `reglasReaplicadas === 1` (la regla de prueba, reaplicada de punta a punta), `errores` vacío.

```bash
npx tsx scripts/_tmp_task9_verify.ts estado
```

Confirmar: la compra sigue `esDistribuido = true`, y su distribución ahora suma $9.000 (el importe nuevo), no $8.500.

- [ ] **Step 6: Confirmar el guard 409 sobre la compra distribuida**

Con sesión iniciada en el dashboard (browser), intentar editar manualmente (importe/fecha/concepto) la compra usada en el Step 5 desde `compras-detalle-modal.tsx`. Confirmar: el botón Editar aparece deshabilitado (Task 8) — o, si se fuerza el PATCH directo (ej. `curl` con cookie de sesión válida), confirmar respuesta `409` con el mensaje del guard (Task 6).

- [ ] **Step 7: Confirmar auto-aplicación a una compra "nueva" del mismo concepto**

Elegir una fila del Excel de compras que NO exista todavía en la base (mismo criterio de "compra nueva" que ya usa el ETL) para el concepto `913`, con fecha dentro del histórico (la regla de prueba es modo `historico`, cubre cualquier fecha). Reimportarla:

```bash
npx tsx scripts/_tmp_task9_verify.ts reimportar '{"COD_CGA":"913","FECHA":45010,"CODIGO":null,"CONCEPTO":"Mantenimiento Vidrios","DETALLE":"prueba-fase-d-task9","PROVEEDOR":null,"OBSERVAC":null,"IMPORTE":5000,"IMP_INT":0,"IMPUTAC":null,"PER1":0,"PER2":0,"PER3":0}'
```

Confirmar: `normalizeCompras.created === 1`; `sincronizarTrasImport.reglasReaplicadas === 1`.

```bash
npx tsx scripts/_tmp_task9_verify.ts estado
```

Confirmar: la compra nueva aparece con `esDistribuido = true` sin haber creado ninguna regla nueva — la regla de prueba ya activa la absorbió automáticamente.

- [ ] **Step 8: Revertir todo**

```bash
npx tsx scripts/_tmp_task9_verify.ts revertir
```

Borrar manualmente la compra sintética creada en el Step 7 (la del Step 5 ya existía antes de la prueba — dejarla con su importe restaurado, ver abajo):

```bash
npx tsx -e "
import { getEtlClient } from './lib/etl/etl-client';
const prisma = getEtlClient();
await prisma.compra.deleteMany({ where: { detalle: 'prueba-fase-d-task9' } });
"
```

Restaurar el importe original de la compra usada en el Step 5 (el que se anotó en el Step 3) con otra reimportación simulada (mismo `rowId`, `IMPORTE` original):

```bash
npx tsx scripts/_tmp_task9_verify.ts reimportar '{"COD_CGA":"913", ... "IMPORTE": <importe original>, ...}'
```

```bash
npx tsx scripts/_tmp_task9_verify.ts estado
```

Confirmar: 0 reglas para el concepto `913`, todas las compras `esDistribuido = false`, importes idénticos al Step 3 (byte a byte, mismo criterio de reversión ya usado en Fase B/C).

- [ ] **Step 9: Borrar el script descartable**

```bash
rm scripts/_tmp_task9_verify.ts
```

No commitear este script — es temporal, mismo patrón que Fase C.

- [ ] **Step 10: Suite completa + build**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Expected: todo limpio.

---

## Correcciones encontradas al escribir este plan

- El diseño técnico (sección 10.3) mencionaba "12 campos ERP-controlados" pero la enumeración real (`codCga`, `concepto`, `fecha`, `codigo`, `proveedor`, `detalle`, `observac`, `importe`, `impInt`, `imputac`, `per1`, `per2`, `per3`) son 13 — corregido en este plan (Global Constraints y Task 1).
- El endpoint `POST /api/etl/drive-import` cambia de forma de respuesta (`ETLReport[]` → `{ reports, apertura }`) para poder devolver los errores de sincronización sin tragarlos en silencio — esto rompe a su único consumidor actual (`hooks/use-drive-import.ts`), así que Task 5 incluye actualizarlo en el mismo commit, no como un cambio aparte.
- `v_compras_distribuidas` no necesita ninguna migración de schema nueva para exponer `esDistribuido` en la lista completa de `detalle` — `distribucionId IS NOT NULL` ya es equivalente por construcción de la vista (Task 7, Step 4).
