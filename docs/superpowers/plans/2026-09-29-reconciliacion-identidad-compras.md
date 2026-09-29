# Reconciliación de identidad de compras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Nota crítica:** las Tasks 1-5 son desarrollo normal de código con TDD, delegables a un subagente. La Task 6 (ejecución real contra producción) tiene puntos que requieren confirmación humana explícita en el momento — revisar el resultado del dry-run antes de aprobar seguir, y confirmar que el `pg_dump` ya se corrió antes de ejecutar `--apply`. **La Task 6 completa debe correr en la conversación principal con el usuario presente — nunca vía `subagent-driven-development`/`dispatching-parallel-agents`, sin excepción (CLAUDE.md §9.1: esos dos flujos no pueden ejecutar cambios sobre compras/ventas ya importados de forma autónoma).** El `--apply` en sí es la acción más sensible de todo este plan (borra datos financieros reales) y necesita luz verde en el momento, no alcanza con que la spec ya esté aprobada.

**Goal:** Cortar la duplicación de compras que ocurre cuando el ERP edita comprobante/observación después de la carga inicial (root cause distinta al incidente de agosto), y limpiar los 54 duplicados ya existentes en producción.

**Architecture:** Un mecanismo de reconciliación dentro de `normalizeCompras` que, ante una fila "nueva" (hash de identidad sin match), busca una fila existente con el mismo ancla estable (`codCga+fecha+codigo+concepto+importe`) y le renombra el `rowId` en vez de insertar un duplicado — aprovechando que las FK relevantes ya tienen `ON UPDATE CASCADE`. Más un script (`scripts/reconciliar-duplicados-erp.ts`) con función pura testeable que aplica el mismo criterio retroactivamente a los 54 duplicados ya en producción — mismo patrón dry-run/`--apply` que `scripts/cleanup-duplicados-compras.ts` (agosto).

**Tech Stack:** TypeScript, Prisma 7, vitest, tsx, Next.js (UI del import).

**Spec:** `docs/superpowers/specs/2026-09-29-reconciliacion-identidad-compras-design.md`

## Global Constraints

- El ancla de reconciliación es `codCga+fechaISO+codigo+concepto+importe` — exacta, sin tolerancia. `FECHA` nunca se relaja (spec §1/§3 — sin evidencia real de que cambie, y relajarla generaría fusiones falsas entre compras recurrentes legítimas).
- Si `importe` es `null`, no se intenta reconciliar (spec §4.1).
- La reconciliación hacia adelante (import) nunca borra — solo renombra el `rowId` de una fila existente vía `prisma.compra.update` (mismo patrón ya usado en `scripts/migrate-rowid-compras.ts`), y solo cuando hay exactamente 1 candidato. 0 candidatos → insert normal. 2+ candidatos → ambiguo, no se fusiona, se reporta (spec §4.2).
- El script de limpieza retroactiva recalcula el plan EN VIVO justo antes de `--apply`, nunca reusa el dry-run (mismo patrón que agosto).
- `pg_dump` completo es precondición manual antes de `--apply` — lo corre el usuario, el script no lo automatiza.
- Todo el borrado de la limpieza retroactiva corre dentro de una única `prisma.$transaction`.
- Grupos con forma inesperada, ambas `esDistribuido=true`, empate de longitud de `observac`, o `detalle_compras` propio en la fila a descartar se EXCLUYEN automáticamente en la limpieza retroactiva — nunca se fuerza el borrado de un caso no verificado como seguro (spec §4.3).
- Export del listado borrado a JSON en `tmp/reconciliar-duplicados-erp/` (gitignored, mismo patrón que scripts anteriores).

---

### Task 1: Ancla estable y selección de candidato de reconciliación (`compra-identity.ts`)

**Files:**
- Modify: `lib/etl/normalizers/compra-identity.ts`
- Test: `lib/etl/normalizers/compra-identity.test.ts`

**Interfaces:**
- Consumes: `CompraIdentityInput` (ya existe en este archivo, sin cambios).
- Produces: `interface CompraAnchor`, `function computeCompraAnchor(input: CompraIdentityInput): CompraAnchor`, `function pickReconciliationCandidate<T extends { rowId: string }>(candidatos: T[]): T | null` — usados por Task 2.

- [ ] **Step 1: Escribir los tests (fallan — las funciones todavía no existen)**

Agregar al final de `lib/etl/normalizers/compra-identity.test.ts` (y ampliar el import del principio del archivo):

```typescript
import {
  parseComprobanteFromDetalle,
  computeCompraRowId,
  compraIdentityFromRawRow,
  compraIdentityFromDbRecord,
  computeCompraAnchor,
  pickReconciliationCandidate,
} from "./compra-identity";
```

```typescript
describe("computeCompraAnchor", () => {
  it("proyecta solo los campos estables (codCga, fechaISO, codigo, concepto, importe)", () => {
    const input = {
      codCga: "201", fechaISO: "2026-08-24", codigo: "68", concepto: "Servicio de Energia Electrica",
      comprobante: "B002752273860", detalle: "B 0027-52273860", observacNormalizado: "Del 23/7 Al 24/8", importe: "1552076.41",
    };
    expect(computeCompraAnchor(input)).toEqual({
      codCga: "201", fechaISO: "2026-08-24", codigo: "68", concepto: "Servicio de Energia Electrica", importe: "1552076.41",
    });
  });

  // Regresión: hallazgo real en producción (29-sep-2026) — el comprobante
  // aparece después de la carga inicial y cambia detalle/observac/comprobante,
  // pero es la misma compra real. El ancla tiene que ignorar esos 3 campos
  // para que la reconciliación los encuentre como la misma transacción.
  it("dos inputs que solo difieren en comprobante/detalle/observacNormalizado dan el mismo ancla", () => {
    const base = {
      codCga: "201", fechaISO: "2026-08-24", codigo: "68", concepto: "Servicio de Energia Electrica",
      comprobante: null, detalle: null, observacNormalizado: "Del 23/7 Al 24/8", importe: "1552076.41",
    };
    const conComprobante = { ...base, comprobante: "B002752273860", detalle: "B 0027-52273860" };
    expect(computeCompraAnchor(base)).toEqual(computeCompraAnchor(conComprobante));
  });

  it("dos inputs que difieren en importe dan ancla distinta", () => {
    const base = {
      codCga: "201", fechaISO: "2026-08-24", codigo: "68", concepto: "Servicio de Energia Electrica",
      comprobante: null, detalle: null, observacNormalizado: null, importe: "1000",
    };
    expect(computeCompraAnchor(base)).not.toEqual(computeCompraAnchor({ ...base, importe: "2000" }));
  });
});

describe("pickReconciliationCandidate", () => {
  it("0 candidatos: null", () => {
    expect(pickReconciliationCandidate([])).toBeNull();
  });

  it("1 candidato: lo elige", () => {
    const candidato = { rowId: "abc" };
    expect(pickReconciliationCandidate([candidato])).toBe(candidato);
  });

  it("2+ candidatos: ambiguo, null (no fusiona)", () => {
    expect(pickReconciliationCandidate([{ rowId: "a" }, { rowId: "b" }])).toBeNull();
  });
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `npx vitest run lib/etl/normalizers/compra-identity.test.ts`
Expected: FAIL — `computeCompraAnchor`/`pickReconciliationCandidate` no existen todavía (error de import).

- [ ] **Step 3: Implementar las funciones**

Agregar al final de `lib/etl/normalizers/compra-identity.ts`:

```typescript
export interface CompraAnchor {
  codCga: string | null;
  fechaISO: string | null;
  codigo: string | null;
  concepto: string | null;
  importe: string | null;
}

// Subconjunto estable de CompraIdentityInput usado para reconciliar una fila
// "nueva" (hash de computeCompraRowId sin match) contra una fila existente
// que sea la misma compra real editada por el ERP después de la carga
// inicial — ver docs/superpowers/specs/2026-09-29-reconciliacion-identidad-
// compras-design.md. Deliberadamente NO incluye comprobante/detalle/
// observacNormalizado: son justamente los campos que el ERP edita post-carga
// (comprobante que aparece, observación que se corrige) y por eso rompen el
// hash de computeCompraRowId sin ser, en los hechos, una transacción nueva.
export function computeCompraAnchor(input: CompraIdentityInput): CompraAnchor {
  return {
    codCga: input.codCga,
    fechaISO: input.fechaISO,
    codigo: input.codigo,
    concepto: input.concepto,
    importe: input.importe,
  };
}

// Decide si una fila "nueva" debe reconciliarse con una de las filas
// existentes que comparten su ancla. Exactamente 1 candidato -> se
// reconcilia con esa. 0 candidatos -> nada que reconciliar (se maneja antes
// de llamar a esta función). 2+ candidatos -> ambiguo, no se fusiona (evita
// el caso real de una factura con más de un ítem que coincide en ancla —
// ver spec, caso "mochila/válvula").
export function pickReconciliationCandidate<T extends { rowId: string }>(candidatos: T[]): T | null {
  return candidatos.length === 1 ? candidatos[0] : null;
}
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `npx vitest run lib/etl/normalizers/compra-identity.test.ts`
Expected: PASS — todos los tests del archivo, incluidos los nuevos.

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/compra-identity.ts lib/etl/normalizers/compra-identity.test.ts
git commit -m "feat(compras): agrega ancla estable y selección de candidato para reconciliación de identidad"
```

---

### Task 2: Reconciliación en el import (`compras.ts`)

**Files:**
- Modify: `lib/etl/normalizers/compras.ts`
- Modify: `lib/etl/test-utils/mock-db.ts`
- Test: `lib/etl/normalizers/compras.test.ts`

**Interfaces:**
- Consumes: `computeCompraAnchor`, `pickReconciliationCandidate` (Task 1).
- Produces: `normalizeCompras` ahora devuelve además `comprasReconciliadas: string[]` y `reconciliacionesAmbiguas: { rowIdNuevo: string; candidatos: string[] }[]` — usados por Task 3.

- [ ] **Step 1: Extender `mock-db.ts` para soportar `.update()` en cualquier modelo mockeado**

Reemplazar el contenido completo de `lib/etl/test-utils/mock-db.ts`:

```typescript
import { vi } from "vitest";
import type { DbClient } from "../types";

type ModelMock = { findMany: ReturnType<typeof vi.fn>; update?: ReturnType<typeof vi.fn> };

/**
 * DbClient falso para tests unitarios de normalizers — sin base de datos real.
 * findMany por defecto devuelve [] (nada existe todavía); update por defecto
 * resuelve OK. Un override parcial (solo findMany, por ejemplo) se mergea
 * sobre estos defaults, no los reemplaza entero — así ningún test existente
 * que no conoce `.update()` se rompe al agregarlo acá.
 * $executeRaw por defecto resuelve OK; usar mockRejectedValueOnce para testear
 * el path de `errors` ante fallos de constraint.
 */
export function createMockDb(overrides: Partial<Record<string, ModelMock>> = {}) {
  const defaultModel = (): Required<ModelMock> => ({
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  });
  const db = {
    proveedor: { ...defaultModel(), ...overrides.proveedor },
    conceptoCaja: { ...defaultModel(), ...overrides.conceptoCaja },
    articulo: { ...defaultModel(), ...overrides.articulo },
    compra: { ...defaultModel(), ...overrides.compra },
    detalleCompra: { ...defaultModel(), ...overrides.detalleCompra },
    venta: { ...defaultModel(), ...overrides.venta },
    rubroArticulo: { ...defaultModel(), ...overrides.rubroArticulo },
    rubroConceptoCaja: { ...defaultModel(), ...overrides.rubroConceptoCaja },
    subrubroArticulo: { ...defaultModel(), ...overrides.subrubroArticulo },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  return db as unknown as DbClient;
}

/**
 * Simula "todo lo consultado ya existe" (findMany hace eco de los IDs pedidos)
 * para poder testear el conteo `updated` sin conocer los hashes rowId de antemano.
 */
export function mockAllExisting(model: ModelMock, idField: "rowId" | "codigo") {
  model.findMany.mockImplementation(
    async (args: { where?: Record<string, { in?: string[] }> }) => {
      const ids = args?.where?.[idField]?.in ?? [];
      return ids.map((id) => ({ [idField]: id }));
    }
  );
}
```

- [ ] **Step 2: Escribir los tests de reconciliación (fallan — `comprasReconciliadas`/`reconciliacionesAmbiguas` todavía no existen)**

Agregar al final de `lib/etl/normalizers/compras.test.ts`, dentro del `describe("normalizeCompras", ...)` existente (antes del `});` de cierre del archivo):

```typescript
  describe("reconciliación de identidad (ERP edita comprobante/observac post-carga)", () => {
    function huerfana(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        rowId: "huerfana-rowid",
        esDistribuido: false,
        codCga: "GASTO1", concepto: "Alquiler", fecha: safeDate(45000), codigo: "PROV1",
        proveedor: "Juan Perez", detalle: null, observac: "Obs vieja",
        importe: { toString: () => "1000" }, impInt: { toString: () => "0" }, imputac: "X",
        per1: { toString: () => "0" }, per2: { toString: () => "0" }, per3: { toString: () => "0" },
        ...overrides,
      };
    }

    it("fila nueva sin candidatos de reconciliación: se crea normal, no reconcilia", async () => {
      const db = createMockDb();
      const res = await normalizeCompras([baseRow()], db);
      expect(res.created).toBe(1);
      expect(res.comprasReconciliadas).toEqual([]);
      expect(res.reconciliacionesAmbiguas).toEqual([]);
    });

    it("fila nueva que matchea el ancla de una huérfana existente: reconcilia (rename) en vez de crear", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return []; // sin match exacto por hash
          return [huerfana()]; // match por ancla
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const res = await normalizeCompras([baseRow()], db);
      expect(res.created).toBe(0);
      expect(res.updated).toBe(1);
      expect(res.comprasReconciliadas).toEqual(["huerfana-rowid"]);
      expect(compraModel.update).toHaveBeenCalledWith({
        where: { rowId: "huerfana-rowid" },
        data: { rowId: expect.any(String) },
      });
    });

    it("fila nueva con 2+ candidatos por el mismo ancla: no fusiona (ambiguo), se crea normal y queda reportado", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return [];
          return [huerfana({ rowId: "huerfana-1" }), huerfana({ rowId: "huerfana-2" })];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const res = await normalizeCompras([baseRow()], db);
      expect(res.created).toBe(1);
      expect(compraModel.update).not.toHaveBeenCalled();
      expect(res.reconciliacionesAmbiguas).toHaveLength(1);
      expect(res.reconciliacionesAmbiguas[0].candidatos.sort()).toEqual(["huerfana-1", "huerfana-2"]);
    });

    it("huérfana reconciliada con esDistribuido=true y campos ERP distintos: aparece también en comprasDistribuidasModificadas", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return [];
          return [huerfana({ rowId: "huerfana-distribuida", esDistribuido: true })];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const res = await normalizeCompras([baseRow({ DETALLE: "A 0606-00761530" })], db);
      expect(res.comprasReconciliadas).toEqual(["huerfana-distribuida"]);
      expect(res.comprasDistribuidasModificadas).toEqual(["huerfana-distribuida"]);
    });

    it("importe nulo en la fila: no intenta reconciliar (sin evidencia de este caso, ver spec)", async () => {
      const compraModel = {
        findMany: vi.fn().mockImplementation(async (args: { where?: { rowId?: { in?: string[] } } }) => {
          if (args?.where?.rowId?.in) return [];
          return [huerfana()];
        }),
        update: vi.fn().mockResolvedValue({}),
      };
      const db = createMockDb({ compra: compraModel });
      const res = await normalizeCompras([baseRow({ IMPORTE: null })], db);
      expect(compraModel.update).not.toHaveBeenCalled();
      expect(res.comprasReconciliadas).toEqual([]);
    });
  });
```

- [ ] **Step 3: Correr los tests para confirmar que fallan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: FAIL — `res.comprasReconciliadas`/`res.reconciliacionesAmbiguas` son `undefined` (la función todavía no los devuelve).

- [ ] **Step 4: Implementar la reconciliación**

En `lib/etl/normalizers/compras.ts`, cambiar la línea de import de `compra-identity`:

```typescript
import { parseComprobanteFromDetalle, computeCompraRowId, compraIdentityFromRawRow } from "./compra-identity";
```

por:

```typescript
import {
  parseComprobanteFromDetalle,
  computeCompraRowId,
  compraIdentityFromRawRow,
  computeCompraAnchor,
  pickReconciliationCandidate,
} from "./compra-identity";
```

Cambiar la firma de `normalizeCompras` (el tipo de retorno de la `Promise`), agregando los dos campos nuevos:

```typescript
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
  comprasReconciliadas: string[];
  reconciliacionesAmbiguas: { rowIdNuevo: string; candidatos: string[] }[];
}> {
```

Cambiar la inicialización de acumuladores (donde hoy está `const comprasDistribuidasModificadas: string[] = [];`):

```typescript
  let created = 0;
  let updated = 0;
  const comprasDistribuidasModificadas: string[] = [];
  const comprasReconciliadas: string[] = [];
  const reconciliacionesAmbiguas: { rowIdNuevo: string; candidatos: string[] }[] = [];
```

Justo después de `const existingMap = new Map(existingRows.map((r) => [r.rowId, r]));` y como primera instrucción dentro del `try {` existente (antes de `const rowValues = chunk.map(...)`), agregar el bloque de reconciliación:

```typescript
    try {
      // Reconciliación: una fila cuyo hash no matchea ninguna existente puede
      // ser la misma compra real que el ERP editó después de la carga inicial
      // (comprobante que aparece, observación corregida — ver
      // docs/superpowers/specs/2026-09-29-reconciliacion-identidad-compras-design.md).
      // Migra el rowId de la fila vieja al hash nuevo ANTES del INSERT...ON
      // CONFLICT de abajo, para que ese mismo INSERT la encuentre y actualice
      // sus campos normalmente en vez de crear una fila duplicada.
      for (const pr of chunk) {
        if (existingMap.has(pr.rowId)) continue;
        const anchor = computeCompraAnchor(compraIdentityFromRawRow(pr.row));
        if (anchor.importe == null || anchor.fechaISO == null) continue;

        const candidatos = await prisma.compra.findMany({
          where: {
            codCga: anchor.codCga,
            fecha: new Date(anchor.fechaISO),
            codigo: anchor.codigo,
            concepto: anchor.concepto,
            importe: new Prisma.Decimal(anchor.importe),
            rowId: { notIn: chunkRowIds },
          },
          select: {
            rowId: true, esDistribuido: true,
            codCga: true, concepto: true, fecha: true, codigo: true, proveedor: true,
            detalle: true, observac: true, importe: true, impInt: true, imputac: true,
            per1: true, per2: true, per3: true,
          },
        });
        if (candidatos.length === 0) continue;

        const elegido = pickReconciliationCandidate(candidatos);
        if (elegido) {
          await prisma.compra.update({ where: { rowId: elegido.rowId }, data: { rowId: pr.rowId } });
          comprasReconciliadas.push(elegido.rowId);
          existingMap.set(pr.rowId, elegido);
        } else {
          reconciliacionesAmbiguas.push({ rowIdNuevo: pr.rowId, candidatos: candidatos.map((c) => c.rowId) });
        }
      }

      const rowValues = chunk.map(({ rowId, row, data }) => {
```

(El resto del `try` — `rowValues`, el `$executeRaw`, y el loop final de conteo `created`/`updated`/`comprasDistribuidasModificadas` — queda exactamente igual: el `existingMap.set(pr.rowId, elegido)` de arriba hace que ese loop final trate la fila reconciliada como "actualizada" automáticamente, sin tocar esa parte del código.)

Por último, cambiar el `return` final de la función:

```typescript
  return { created, updated, skipped, skippedRows, errors, comprasDistribuidasModificadas };
}
```

por:

```typescript
  return {
    created, updated, skipped, skippedRows, errors,
    comprasDistribuidasModificadas, comprasReconciliadas, reconciliacionesAmbiguas,
  };
}
```

- [ ] **Step 5: Correr los tests para confirmar que pasan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: PASS — todos los tests del archivo, incluidos los nuevos de reconciliación.

- [ ] **Step 6: Correr toda la suite para confirmar que no rompió otros normalizers**

Run: `npx vitest run`
Expected: PASS — el cambio de `mock-db.ts` es aditivo (mergea defaults en vez de reemplazar), no debería afectar `ventas.test.ts` ni el resto.

- [ ] **Step 7: Commit**

```bash
git add lib/etl/normalizers/compras.ts lib/etl/test-utils/mock-db.ts lib/etl/normalizers/compras.test.ts
git commit -m "feat(compras): reconcilia filas nuevas con huérfanas existentes por ancla estable en vez de duplicar"
```

---

### Task 3: Propagar los campos nuevos del reporte ETL (`types.ts` + `run-etl.ts`)

**Files:**
- Modify: `lib/etl/types.ts`
- Modify: `lib/etl/run-etl.ts`

**Interfaces:**
- Consumes: `comprasReconciliadas`/`reconciliacionesAmbiguas` devueltos por `normalizeCompras` (Task 2).
- Produces: `ETLReport.comprasReconciliadas?: string[]`, `ETLReport.reconciliacionesAmbiguas?: ETLReconciliacionAmbigua[]`, `interface ETLReconciliacionAmbigua` — usados por Task 4.

- [ ] **Step 1: Agregar los campos a `ETLReport` en `types.ts`**

En `lib/etl/types.ts`, agregar esta interfaz nueva justo antes de `export interface ETLReport {`:

```typescript
export interface ETLReconciliacionAmbigua {
  rowIdNuevo: string;
  candidatos: string[];
}
```

Y dentro de `ETLReport`, agregar estas dos líneas después de `comprasDistribuidasModificadas?: string[];`:

```typescript
  comprasReconciliadas?: string[];
  reconciliacionesAmbiguas?: ETLReconciliacionAmbigua[];
```

- [ ] **Step 2: Propagar los campos en `run-etl.ts`**

Cambiar el import de tipos en `lib/etl/run-etl.ts`:

```typescript
import type { ETLReport, ETLContext, ETLRow, ETLRowError, ETLSkippedRow, DbClient } from "./types";
```

por:

```typescript
import type { ETLReport, ETLContext, ETLRow, ETLRowError, ETLSkippedRow, ETLReconciliacionAmbigua, DbClient } from "./types";
```

Cambiar el tipo `NormalizerFn`:

```typescript
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

por:

```typescript
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
  comprasReconciliadas?: string[];
  reconciliacionesAmbiguas?: ETLReconciliacionAmbigua[];
}>;
```

Cambiar la desestructuración y el `return` dentro de `runETL`:

```typescript
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

por:

```typescript
  const {
    created, updated, skipped, skippedRows, errors,
    comprasDistribuidasModificadas, comprasReconciliadas, reconciliacionesAmbiguas,
  } = await normalizer(rows, client, ctx);

  return {
    fileType,
    totalRows: rows.length,
    created,
    updated,
    skipped,
    skippedRows,
    errors,
    comprasDistribuidasModificadas,
    comprasReconciliadas,
    reconciliacionesAmbiguas,
    durationMs: Date.now() - startMs,
    storagePath,
  };
```

- [ ] **Step 3: Verificar tipos y que la suite sigue pasando**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npx vitest run`
Expected: PASS — este task es wiring de tipos, no cambia comportamiento de ningún normalizer existente.

- [ ] **Step 4: Commit**

```bash
git add lib/etl/types.ts lib/etl/run-etl.ts
git commit -m "feat(etl): propaga comprasReconciliadas y reconciliacionesAmbiguas en ETLReport"
```

---

### Task 4: Mostrar reconciliaciones en la UI de import (`drive-folder.tsx`)

**Files:**
- Modify: `app/(shell)/importar/drive-folder.tsx`

**Interfaces:**
- Consumes: `report.comprasReconciliadas`, `report.reconciliacionesAmbiguas` (Task 3).
- Produces: ninguna nueva — solo UI.

- [ ] **Step 1: Agregar el badge de reconciliados**

En `app/(shell)/importar/drive-folder.tsx`, dentro de `ReportCard`, cambiar:

```tsx
      <div className="flex gap-2 flex-wrap">
        <Badge className="bg-success/15 text-success hover:bg-success/15 border-0 text-xs">
          {report.created} creados
        </Badge>
        <Badge variant="secondary" className="text-xs">{report.updated} actualizados</Badge>
        {report.skipped > 0 && (
          <Badge variant="outline" className="text-xs">{report.skipped} omitidos</Badge>
        )}
        {report.errors.length > 0 && (
          <Badge variant="destructive" className="text-xs">{report.errors.length} errores</Badge>
        )}
      </div>
```

por:

```tsx
      <div className="flex gap-2 flex-wrap">
        <Badge className="bg-success/15 text-success hover:bg-success/15 border-0 text-xs">
          {report.created} creados
        </Badge>
        <Badge variant="secondary" className="text-xs">{report.updated} actualizados</Badge>
        {report.skipped > 0 && (
          <Badge variant="outline" className="text-xs">{report.skipped} omitidos</Badge>
        )}
        {report.comprasReconciliadas && report.comprasReconciliadas.length > 0 && (
          <Badge variant="secondary" className="text-xs">{report.comprasReconciliadas.length} reconciliados</Badge>
        )}
        {report.errors.length > 0 && (
          <Badge variant="destructive" className="text-xs">{report.errors.length} errores</Badge>
        )}
      </div>
```

- [ ] **Step 2: Agregar el detalle de reconciliaciones ambiguas**

En el mismo componente `ReportCard`, ubicar el cierre del bloque de errores (el final exacto es este fragmento, sin cambios):

```tsx
            {report.errors.map((e, i) => (
              <li key={i} className="font-mono text-zinc-500 dark:text-zinc-400">
                Fila {e.rowIndex + 1} · {String(e.rawCodigo ?? "?")} · {translateError(e.message)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
```

Insertar el bloque nuevo justo antes del `</div>` que cierra `ReportCard` (el que está inmediatamente después del `)}` de cierre de `{report.errors.length > 0 && (...)}`), de forma que el fragmento de arriba quede así:

```tsx
            {report.errors.map((e, i) => (
              <li key={i} className="font-mono text-zinc-500 dark:text-zinc-400">
                Fila {e.rowIndex + 1} · {String(e.rawCodigo ?? "?")} · {translateError(e.message)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {report.reconciliacionesAmbiguas && report.reconciliacionesAmbiguas.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-medium transition-colors">
            Ver {report.reconciliacionesAmbiguas.length} reconciliaciones ambiguas
          </summary>
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {report.reconciliacionesAmbiguas.map((r, i) => (
              <li key={i} className="font-mono text-zinc-500 dark:text-zinc-400">
                Posible duplicado sin resolver — {r.candidatos.length} candidatos encontrados, revisar manualmente
              </li>
            ))}
          </ul>
        </details>
      )}
```

- [ ] **Step 3: Verificar tipos y lint**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

**Nota de verificación manual:** este cambio es puramente visual y no tiene test automatizado — el patrón existente del proyecto para `ReportCard` tampoco lo tiene (ver `skippedRows`/`errors`, que siguen el mismo estilo sin test dedicado). Verificar en el browser (`npm run dev`, ir a `/importar`) requiere un import real que dispare una reconciliación o una ambigüedad, lo cual va a pasar naturalmente en la Task 6 (ejecución real contra producción) — no está garantizado poder verlo antes de esa task. Si al llegar a la Task 6 el dry-run real dispara alguna reconciliación vía la UI de import (no solo el script), revisar visualmente en ese momento; si no, dejarlo documentado como limitación conocida (mismo criterio que Fase C de Apertura de Gastos, 20-ago-2026: "verificado sin browser, limitación real").

- [ ] **Step 4: Commit**

```bash
git add "app/(shell)/importar/drive-folder.tsx"
git commit -m "feat(importar): muestra compras reconciliadas y reconciliaciones ambiguas en el reporte de import"
```

---

### Task 5: Script de limpieza retroactiva — función pura (TDD) + CLI dry-run/`--apply`

**Files:**
- Create: `scripts/reconciliar-duplicados-erp.ts`
- Test: `scripts/reconciliar-duplicados-erp.test.ts`

**Interfaces:**
- Consumes: ninguna de los tasks anteriores (función pura independiente, mismo criterio que `scripts/cleanup-duplicados-compras.ts`).
- Produces: `interface CompraParaReconciliar`, `interface GrupoExcluido`, `interface PlanReconciliacion`, `function planReconciliacionDuplicados(compras: CompraParaReconciliar[]): PlanReconciliacion`, y el script CLI completo — usados por Task 6.

- [ ] **Step 1: Escribir el test de la función pura (falla — el archivo no existe)**

Crear `scripts/reconciliar-duplicados-erp.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { planReconciliacionDuplicados, type CompraParaReconciliar } from "./reconciliar-duplicados-erp";

const BASE = {
  codCga: "201",
  fecha: new Date("2026-08-24"),
  codigo: "68",
  concepto: "Servicio de Energia Electrica",
  importe: { toString: () => "1552076.41" },
};

function fila(overrides: Partial<CompraParaReconciliar> = {}): CompraParaReconciliar {
  return {
    ...BASE,
    rowId: "rowid-generico",
    observac: "Del 23/7 Al 24/8",
    esDistribuido: false,
    tieneDetalleCompras: false,
    ...overrides,
  };
}

describe("planReconciliacionDuplicados", () => {
  it("grupo de 2 sin distribuidas: sobrevive la de OBSERVAC más largo, la otra va a rowIdABorrar", () => {
    const corta = fila({ rowId: "corta", observac: "Turbina Inflable" });
    const larga = fila({ rowId: "larga", observac: "Turbina Inflable Nuevo" });
    const plan = planReconciliacionDuplicados([corta, larga]);
    expect(plan.rowIdABorrar).toEqual(["corta"]);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });

  it("grupo de 2 con exactamente 1 esDistribuido=true: esa sobrevive siempre, aunque su OBSERVAC sea más corto", () => {
    const distribuida = fila({ rowId: "distribuida", observac: "Cable Para Alargues Kids Park", esDistribuido: true });
    const noDistribuida = fila({ rowId: "no-distribuida", observac: "Cable Para Alargues Kids Park 50%" });
    const plan = planReconciliacionDuplicados([distribuida, noDistribuida]);
    expect(plan.rowIdABorrar).toEqual(["no-distribuida"]);
  });

  it("empate de longitud de observac sin distribuidas: grupo excluido, no se borra nada", () => {
    const a = fila({ rowId: "a", observac: "Mochila Baño Vestuario" });
    const b = fila({ rowId: "b", observac: "Valvula Descarga Baños" }); // mismo largo (22) a propósito
    const plan = planReconciliacionDuplicados([a, b]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("empate de longitud de observac, revisar a mano");
  });

  it("ambas filas con esDistribuido=true: grupo excluido, revisar a mano", () => {
    const a = fila({ rowId: "a", esDistribuido: true });
    const b = fila({ rowId: "b", esDistribuido: true });
    const plan = planReconciliacionDuplicados([a, b]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos[0].motivo).toBe("ambas filas tienen esDistribuido=true, revisar a mano");
  });

  it("la fila a descartar tiene detalle_compras propio: grupo excluido", () => {
    const corta = fila({ rowId: "corta", observac: "A", tieneDetalleCompras: true });
    const larga = fila({ rowId: "larga", observac: "AB" });
    const plan = planReconciliacionDuplicados([corta, larga]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos[0].motivo).toBe("la fila a descartar tiene detalle_compras propio");
  });

  it("grupo de 3+ filas con la misma ancla: forma inesperada, excluido", () => {
    const plan = planReconciliacionDuplicados([
      fila({ rowId: "a" }), fila({ rowId: "b" }), fila({ rowId: "c" }),
    ]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos[0].motivo).toBe("forma inesperada (no son 2 filas)");
  });

  it("sin duplicados: plan vacío", () => {
    const plan = planReconciliacionDuplicados([fila({ rowId: "unica" })]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `npx vitest run scripts/reconciliar-duplicados-erp.test.ts`
Expected: FAIL — el módulo `./reconciliar-duplicados-erp` no existe.

- [ ] **Step 3: Crear el script completo (función pura + CLI dry-run/`--apply`)**

Crear `scripts/reconciliar-duplicados-erp.ts`:

```typescript
/**
 * reconciliar-duplicados-erp.ts
 *
 * Limpia las compras duplicadas por el mecanismo de edición del ERP post-carga
 * (comprobante que aparece después, OBSERVAC que se corrige — ver
 * lib/etl/normalizers/compra-identity.ts, computeCompraAnchor) — ver
 * docs/superpowers/specs/2026-09-29-reconciliacion-identidad-compras-design.md
 * para el contexto completo. Distinto del incidente de agosto
 * (scripts/cleanup-duplicados-compras.ts, causa raíz distinta: esquemas de
 * rowId divergentes entre main/dev).
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar el borrado contra la base real.
 *
 * Uso:
 *   npx tsx scripts/reconciliar-duplicados-erp.ts             # dry-run
 *   npx tsx scripts/reconciliar-duplicados-erp.ts --apply      # aplica de verdad
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import * as path from "path";
import { prisma } from "../lib/prisma";

const SCRATCHPAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "reconciliar-duplicados-erp");

export interface CompraParaReconciliar {
  rowId: string;
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  importe: { toString(): string } | null;
  observac: string | null;
  esDistribuido: boolean;
  tieneDetalleCompras: boolean;
}

export interface GrupoExcluido {
  motivo: string;
  rowIds: string[];
}

export interface PlanReconciliacion {
  rowIdABorrar: string[];
  gruposExcluidos: GrupoExcluido[];
}

// Mismo ancla que computeCompraAnchor (lib/etl/normalizers/compra-identity.ts)
// — codCga+fecha+codigo+concepto+importe, sin comprobante/detalle/observac
// (los campos que el ERP edita post-carga y por eso NO sirven para agrupar
// duplicados acá).
function claveAncla(c: CompraParaReconciliar): string {
  const fechaISO = c.fecha ? c.fecha.toISOString().slice(0, 10) : "null";
  const importe = c.importe != null ? c.importe.toString() : "null";
  return [c.codCga, fechaISO, c.codigo, c.concepto, importe].join("|");
}

// Función pura, testable sin base de datos real. Nunca borra una fila con
// esDistribuido=true si la otra mitad del grupo no lo tiene también — y
// cualquier forma de grupo no verificada como segura se excluye completa en
// vez de forzarse (mismo criterio que scripts/cleanup-duplicados-compras.ts).
export function planReconciliacionDuplicados(compras: CompraParaReconciliar[]): PlanReconciliacion {
  const grupos = new Map<string, CompraParaReconciliar[]>();
  for (const c of compras) {
    const clave = claveAncla(c);
    const grupo = grupos.get(clave) ?? [];
    grupo.push(c);
    grupos.set(clave, grupo);
  }

  const rowIdABorrar: string[] = [];
  const gruposExcluidos: GrupoExcluido[] = [];

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;

    const rowIds = grupo.map((c) => c.rowId);
    if (grupo.length !== 2) {
      gruposExcluidos.push({ motivo: "forma inesperada (no son 2 filas)", rowIds });
      continue;
    }

    const [a, b] = grupo;
    const distribuidas = grupo.filter((c) => c.esDistribuido);

    let survivor: CompraParaReconciliar;
    let loser: CompraParaReconciliar;

    if (distribuidas.length === 1) {
      survivor = distribuidas[0];
      loser = survivor === a ? b : a;
    } else if (distribuidas.length === 0) {
      const largoA = a.observac?.length ?? 0;
      const largoB = b.observac?.length ?? 0;
      if (largoA === largoB) {
        gruposExcluidos.push({ motivo: "empate de longitud de observac, revisar a mano", rowIds });
        continue;
      }
      survivor = largoA > largoB ? a : b;
      loser = survivor === a ? b : a;
    } else {
      gruposExcluidos.push({ motivo: "ambas filas tienen esDistribuido=true, revisar a mano", rowIds });
      continue;
    }

    if (loser.tieneDetalleCompras) {
      gruposExcluidos.push({ motivo: "la fila a descartar tiene detalle_compras propio", rowIds });
      continue;
    }

    rowIdABorrar.push(loser.rowId);
  }

  return { rowIdABorrar, gruposExcluidos };
}

interface CompraDbRow {
  rowId: string;
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  importe: { toString(): string } | null;
  observac: string | null;
  esDistribuido: boolean;
  localId: number | null;
}

const SELECT_COMPRA = {
  rowId: true, codCga: true, fecha: true, codigo: true, concepto: true,
  importe: true, observac: true, esDistribuido: true, localId: true,
} as const;

async function conDetalleCompras<T extends { rowId: string }>(
  client: Pick<typeof prisma, "detalleCompra">,
  compras: T[]
): Promise<(T & { tieneDetalleCompras: boolean })[]> {
  const conteo = await client.detalleCompra.groupBy({
    by: ["compraId"],
    where: { compraId: { not: null } },
    _count: true,
  });
  const rowIdsConDetalle = new Set(
    conteo.map((d) => d.compraId).filter((id): id is string => id !== null)
  );
  return compras.map((c) => ({ ...c, tieneDetalleCompras: rowIdsConDetalle.has(c.rowId) }));
}

async function exportarDetalle(rowIdABorrar: string[], porRowId: Map<string, CompraDbRow>, archivo: string) {
  const detalle = rowIdABorrar.map((rowId) => {
    const c = porRowId.get(rowId)!;
    return {
      rowId: c.rowId,
      importe: c.importe != null ? c.importe.toString() : null,
      fecha: c.fecha,
      localId: c.localId,
    };
  });
  const fs = await import("fs");
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(detalle, null, 2));
  return archivo;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const compras: CompraDbRow[] = await prisma.compra.findMany({ select: SELECT_COMPRA });
  const comprasParaReconciliar = await conDetalleCompras(prisma, compras);
  const plan = planReconciliacionDuplicados(comprasParaReconciliar);
  const porRowId = new Map(comprasParaReconciliar.map((c) => [c.rowId, c]));

  console.log(`\n=== Plan de reconciliación (${apply ? "aplicando" : "dry-run"}) ===`);
  console.log(`Compras totales: ${compras.length}`);
  console.log(`Filas a borrar: ${plan.rowIdABorrar.length}`);
  console.log(`Grupos excluidos (revisar manualmente): ${plan.gruposExcluidos.length}`);
  for (const g of plan.gruposExcluidos) {
    console.log(`  - ${g.motivo}: ${g.rowIds.join(", ")}`);
  }

  const archivoDryRun = await exportarDetalle(plan.rowIdABorrar, porRowId, `${SCRATCHPAD_DIR}/reconciliar-duplicados-dry-run.json`);
  console.log(`Detalle exportado a ${archivoDryRun}`);

  if (!apply) {
    console.log("\nDry-run — no se escribió nada en la base. Re-ejecutar con --apply para aplicar.\n");
    return;
  }

  console.log("\nAplicando...");

  // Recálculo en vivo del plan completo — nunca se reusa el plan de arriba,
  // por si algo cambió la base entre el arranque del script y este punto
  // (mismo criterio que scripts/cleanup-duplicados-compras.ts).
  const comprasEnVivo: CompraDbRow[] = await prisma.compra.findMany({ select: SELECT_COMPRA });
  const comprasParaReconciliarEnVivo = await conDetalleCompras(prisma, comprasEnVivo);
  const planEnVivo = planReconciliacionDuplicados(comprasParaReconciliarEnVivo);
  const porRowIdEnVivo = new Map(comprasParaReconciliarEnVivo.map((c) => [c.rowId, c]));

  if (planEnVivo.rowIdABorrar.length !== plan.rowIdABorrar.length) {
    throw new Error(
      `Plan cambió entre el resumen mostrado y la ejecución: ` +
        `se esperaba borrar ${plan.rowIdABorrar.length} filas, ` +
        `pero el recálculo en vivo encontró ${planEnVivo.rowIdABorrar.length}`
    );
  }

  if (planEnVivo.rowIdABorrar.length === 0) {
    console.log("\nNo hay nada para borrar — no se declara éxito de limpieza.\n");
    return;
  }

  const { cantidadBorrada, totalAntes, totalDespues } = await prisma.$transaction(
    async (tx) => {
      const candidatasAhora = await tx.compra.findMany({
        where: { rowId: { in: planEnVivo.rowIdABorrar } },
        select: { rowId: true, esDistribuido: true },
      });
      if (candidatasAhora.length !== planEnVivo.rowIdABorrar.length) {
        throw new Error(
          `Verificación falló: ${planEnVivo.rowIdABorrar.length} filas candidatas esperadas, ` +
            `${candidatasAhora.length} encontradas justo antes de borrar — alguna desapareció entremedio.`
        );
      }
      const yaDistribuida = candidatasAhora.find((c) => c.esDistribuido);
      if (yaDistribuida) {
        throw new Error(
          `Verificación falló: ${yaDistribuida.rowId} pasó a esDistribuido=true entre el recálculo y el borrado.`
        );
      }

      const distribucionesABorrar = await tx.distribucionApertura.count({
        where: { compraRowId: { in: planEnVivo.rowIdABorrar } },
      });
      if (distribucionesABorrar > 0) {
        throw new Error(
          `No se puede proceder: ${distribucionesABorrar} distribuciones de apertura ` +
            `referencian compras candidatas a borrar. Revisar manualmente estos casos.`
        );
      }

      const totalAntes = await tx.compra.count();

      const resultado = await tx.compra.deleteMany({ where: { rowId: { in: planEnVivo.rowIdABorrar } } });
      if (resultado.count !== planEnVivo.rowIdABorrar.length) {
        throw new Error(
          `Verificación falló: se esperaba borrar ${planEnVivo.rowIdABorrar.length} filas, se borraron ${resultado.count}`
        );
      }

      const totalDespues = await tx.compra.count();
      if (totalDespues !== totalAntes - resultado.count) {
        throw new Error(
          `Verificación falló: conteo post-borrado inconsistente ` +
            `(antes ${totalAntes}, después ${totalDespues}, esperado ${totalAntes - resultado.count})`
        );
      }

      return { cantidadBorrada: resultado.count, totalAntes, totalDespues };
    },
    { timeout: 30000, maxWait: 20000 }
  );

  const archivoAplicado = await exportarDetalle(
    planEnVivo.rowIdABorrar,
    porRowIdEnVivo,
    `${SCRATCHPAD_DIR}/reconciliar-duplicados-aplicado.json`
  );

  console.log(`\n=== Verificación post-reconciliación ===`);
  console.log(`Filas borradas: ${cantidadBorrada}`);
  console.log(`Compras: ${totalDespues} (antes ${totalAntes}, esperado ${totalAntes - cantidadBorrada})`);
  if (planEnVivo.gruposExcluidos.length > 0) {
    console.log(`Grupos excluidos en recálculo en vivo: ${planEnVivo.gruposExcluidos.length}`);
    for (const g of planEnVivo.gruposExcluidos) {
      console.log(`  - ${g.motivo}: ${g.rowIds.join(", ")}`);
    }
  }
  console.log(`Detalle de lo borrado exportado a ${archivoAplicado}`);
  console.log("\nReconciliación completada y verificada.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
```

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `npx vitest run scripts/reconciliar-duplicados-erp.test.ts`
Expected: PASS — 7/7 tests.

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add scripts/reconciliar-duplicados-erp.ts scripts/reconciliar-duplicados-erp.test.ts
git commit -m "feat(compras): script de limpieza retroactiva de duplicados por edición del ERP"
```

---

### Task 6: Ejecución real contra producción

**Files:** ninguno — este task no modifica código, ejecuta el script de Task 5.

**Interfaces:**
- Consumes: el script completo de Task 5.
- Produces: la base de producción sin los 54 duplicados identificados en la spec (50 por comprobante + 4 por observación), con respaldo (`pg_dump` + JSON exportado).

> **Recordatorio: este task completo corre en la conversación principal con el usuario presente, nunca vía subagent-driven-development/dispatching-parallel-agents (ver nota al inicio del plan).**

- [ ] **Step 1: Dry-run**

```bash
npx tsx scripts/reconciliar-duplicados-erp.ts
```

Expected: termina sin error, imprime `Filas a borrar: 54` (o el número real al momento de correrlo — puede diferir levemente de la investigación de esta sesión si pasó tiempo; si difiere, es información nueva a revisar, no un error del script) y `Grupos excluidos: 0` (según lo verificado en esta sesión — 0 filas con `esDistribuido=true` en ambas mitades, 0 con `detalle_compras` propio, ver spec §1/§5). Si aparece cualquier grupo excluido, revisar el motivo antes de seguir.

- [ ] **Step 2: Revisar el resultado con el usuario (confirmación humana explícita)**

Mostrar el resumen impreso y preguntarle al usuario: "¿el número de filas a borrar y de grupos excluidos tiene sentido, seguimos?" — no avanzar al Step 3 sin una respuesta explícita.

- [ ] **Step 3: `pg_dump` (lo corre el usuario, confirmación humana explícita)**

Pedirle al usuario que corra el backup completo de la base (mismo procedimiento ya usado en fases anteriores del proyecto, ej. `pg_dump -Fc "$DIRECT_URL" -f tmp/reconciliar-duplicados-erp/backup-pre-apply-$(date +%Y%m%d-%H%M%S).dump`) y que confirme explícitamente que terminó antes de seguir al Step 4. No ejecutar `--apply` sin esa confirmación en el momento.

- [ ] **Step 4: `--apply`**

```bash
npx tsx scripts/reconciliar-duplicados-erp.ts --apply
```

Expected: termina con "Reconciliación completada y verificada." — si en cambio tira una excepción ("Verificación falló...", "Plan cambió...", o cualquier otro error), DETENERSE, no continuar a ningún otro paso ni de este plan ni de ningún otro, y reportarlo directo al usuario.

- [ ] **Step 5: Verificación final**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
```

Expected: los tres limpios. Además, confirmar manualmente contra la base que `prisma.compra.count()` bajó exactamente en la cantidad de filas borradas (ya lo verifica el propio script en el Step 4, esto es una segunda confirmación independiente si el usuario quiere correrla) y que no quedan grupos duplicados por este mecanismo — se puede re-correr el script en modo dry-run (sin `--apply`) y confirmar `Filas a borrar: 0`.

- [ ] **Step 6: Actualizar memoria del proyecto**

Guardar una memoria de proyecto nueva (`project_reconciliacion_identidad_compras.md`, siguiendo el mismo formato que `project_fix_duplicados_main_dev.md`) con: fecha, cantidad real de filas reconciliadas/borradas, y que el mecanismo de reconciliación hacia adelante ya está en producción (para no reabrir esta investigación si en el futuro aparece un nuevo caso distinto).

---

### Task 7: Verificación final del plan completo

**Files:** ninguno.

- [ ] **Step 1: Suite completa + build**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```

Expected: los cuatro limpios — este es el cierre exigido por CLAUDE.md §7 ("Correr `npm run lint` y build después de cambios relevantes") antes de dar la tarea por cerrada.

- [ ] **Step 2: Confirmar con el usuario**

Resumir al usuario: cuántas filas se reconciliaron/borraron en Task 6, que el mecanismo hacia adelante ya está activo (próxima vez que el ERP edite comprobante/observación de una compra ya importada, el import la va a actualizar en vez de duplicarla), y que las reconciliaciones ambiguas (si las hubo) quedan visibles en el reporte de import de la UI para revisión manual.
