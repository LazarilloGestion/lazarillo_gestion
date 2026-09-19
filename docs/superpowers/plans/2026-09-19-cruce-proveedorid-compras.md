# Fix cruce de proveedorId en compras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Excepción CLAUDE.md §7/§9.1:** Task 5 de este plan ejecuta un `UPDATE` real contra `compras` en producción (dato financiero de cliente). Ni `subagent-driven-development` ni `dispatching-parallel-agents` pueden ejecutar Task 5 de forma autónoma — se corre en la conversación principal, con el usuario presente, con su confirmación explícita antes de `--apply`. Tasks 1-4 (código + tests) sí pueden ejecutarse por subagente normalmente.

**Goal:** Cortar la causa raíz del cruce de `proveedorId` en `compras` (un `CODIGO` de fila que no es un código de proveedor real coincide por azar con el código de un proveedor del maestro) y corregir las filas ya mal linkeadas en producción.

**Architecture:** Un helper puro (`proveedorTextoCoincide` + `resolveProveedorId`) reemplaza el whitelist por nombre de concepto en `compras.ts`, validando el texto crudo del ERP contra el nombre/razón del proveedor candidato antes de confiar en el match por código. `detalle-compras.ts` deja de resolver `proveedorId` de forma independiente (no tiene texto para validar). Un script de backfill (mismo patrón que `cleanup-duplicados-compras.ts`: dry-run → backup → apply con verificación) corrige las filas ya importadas.

**Tech Stack:** TypeScript, Prisma 7 (`$queryRaw`/`$executeRaw` + `Prisma.sql`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-cruce-proveedorid-compras-design.md`

## Global Constraints

- TDD obligatorio para toda esta capa (CLAUDE.md §4, §9.1) — test que falla antes que código.
- Nada de `any` sin justificar; modo estricto de TypeScript.
- Ningún `catch {}` vacío; errores de import/parseo nunca se silencian.
- No agregar dependencias nuevas.
- `npm run lint` y build limpios antes de dar cualquier task por cerrada.
- Task 5 (ejecución del backfill contra producción) requiere confirmación explícita del usuario antes de `--apply` — dato financiero real, sin excepción.

---

## Task 1: Helper de validación — `proveedor-match.ts`

**Files:**
- Create: `lib/etl/normalizers/proveedor-match.ts`
- Test: `lib/etl/normalizers/proveedor-match.test.ts`

**Interfaces:**
- Produces: `export interface ProveedorCandidato { id: number; nombre: string | null; razon: string | null; }`, `export function proveedorTextoCoincide(textoCrudo: string | null, candidato: { nombre: string | null; razon: string | null }): boolean`, `export function resolveProveedorId(codigoFila: string | null, textoProveedor: string | null, provMap: Map<string, ProveedorCandidato>): number | null`. Usados por Task 2 (`compras.ts`) y Task 4 (script de backfill).

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// lib/etl/normalizers/proveedor-match.test.ts
import { describe, it, expect } from "vitest";
import { proveedorTextoCoincide, resolveProveedorId, type ProveedorCandidato } from "./proveedor-match";

describe("proveedorTextoCoincide", () => {
  it("texto crudo coincide exacto con nombre (case/espacios distintos) → true", () => {
    expect(proveedorTextoCoincide("WALDMAN DIEGO MARTIN", { nombre: "Waldman Diego Martin", razon: null })).toBe(true);
  });

  it("texto crudo coincide con puntuación distinta ('/' vs espacio) → true", () => {
    expect(proveedorTextoCoincide("Compra Ocasional / ML", { nombre: "Compra Ocasional Ml", razon: null })).toBe(true);
  });

  it("texto crudo coincide solo con razon, no con nombre → true", () => {
    expect(proveedorTextoCoincide("Juan Perez SRL", { nombre: "Distinto", razon: "Juan Perez SRL" })).toBe(true);
  });

  it("texto crudo no coincide con nombre ni razon → false", () => {
    expect(proveedorTextoCoincide("Diego", { nombre: "Creacion Tm Sr", razon: null })).toBe(false);
  });

  it("placeholder genérico no coincide con un proveedor real → false", () => {
    expect(proveedorTextoCoincide("GASTOS VARIOS", { nombre: "Prosegur", razon: null })).toBe(false);
  });

  it("texto crudo null: sin evidencia en contra, se confía en el candidato → true", () => {
    expect(proveedorTextoCoincide(null, { nombre: "Cualquiera", razon: null })).toBe(true);
  });

  it("candidato sin nombre ni razon y texto presente → false", () => {
    expect(proveedorTextoCoincide("Diego", { nombre: null, razon: null })).toBe(false);
  });
});

describe("resolveProveedorId", () => {
  const provMap = new Map<string, ProveedorCandidato>([
    ["309", { id: 46893, nombre: "Creacion Tm Sr", razon: null }],
    ["3649", { id: 47512, nombre: "Waldman Diego Martin", razon: null }],
  ]);

  it("CODIGO sin match en el maestro → null", () => {
    expect(resolveProveedorId("NOEXISTE", "Cualquiera", provMap)).toBeNull();
  });

  it("CODIGO null → null", () => {
    expect(resolveProveedorId(null, "Cualquiera", provMap)).toBeNull();
  });

  it("caso real de regresión: CODIGO 309 coincide con 'Creacion Tm Sr' pero el texto es 'Diego' → null", () => {
    expect(resolveProveedorId("309", "Diego", provMap)).toBeNull();
  });

  it("CODIGO 3649 con texto 'WALDMAN DIEGO MARTIN' → resuelve al id real", () => {
    expect(resolveProveedorId("3649", "WALDMAN DIEGO MARTIN", provMap)).toBe(47512);
  });
});
```

- [ ] **Step 2: Correr los tests, verificar que fallan**

Run: `npx vitest run lib/etl/normalizers/proveedor-match.test.ts`
Expected: FAIL — `Cannot find module './proveedor-match'`

- [ ] **Step 3: Implementación mínima**

```ts
// lib/etl/normalizers/proveedor-match.ts

// Compara el texto crudo de proveedor de una fila del ERP contra el nombre/razón
// de un proveedor candidato del maestro, normalizando ambos (minúsculas, sin
// signos de puntuación) antes de comparar. Evita confiar ciegamente en un CODIGO
// que coincide por azar con el código de un proveedor real cuando el CODIGO en
// realidad identifica otra cosa (empleado de planilla, "GASTOS VARIOS", etc.) —
// ver docs/superpowers/specs/2026-09-19-cruce-proveedorid-compras-design.md.
//
// Asimetría intencional: sin texto para comparar (null), se confía en el código
// (no hay evidencia en contra). Con texto que no matchea ni nombre ni razón, se
// descarta el link — preferible "Sin Proveedor" a una empresa incorrecta.
export interface ProveedorCandidato {
  id: number;
  nombre: string | null;
  razon: string | null;
}

function normalizarParaComparar(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function proveedorTextoCoincide(
  textoCrudo: string | null,
  candidato: { nombre: string | null; razon: string | null }
): boolean {
  if (textoCrudo == null) return true;
  const t = normalizarParaComparar(textoCrudo);
  return (
    (candidato.nombre != null && normalizarParaComparar(candidato.nombre) === t) ||
    (candidato.razon != null && normalizarParaComparar(candidato.razon) === t)
  );
}

export function resolveProveedorId(
  codigoFila: string | null,
  textoProveedor: string | null,
  provMap: Map<string, ProveedorCandidato>
): number | null {
  if (codigoFila == null) return null;
  const candidato = provMap.get(codigoFila);
  if (!candidato) return null;
  return proveedorTextoCoincide(textoProveedor, candidato) ? candidato.id : null;
}
```

- [ ] **Step 4: Correr los tests, verificar que pasan**

Run: `npx vitest run lib/etl/normalizers/proveedor-match.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/proveedor-match.ts lib/etl/normalizers/proveedor-match.test.ts
git commit -m "feat(etl): valida proveedorId contra el texto crudo del ERP, no solo por código"
```

---

## Task 2: Aplicar la validación en `compras.ts`

**Files:**
- Modify: `lib/etl/normalizers/compras.ts:148-173` (lookup de proveedores + guard de Gastos En Personal), `lib/etl/normalizers/compras.ts:198-200` (resolución de `proveedorId` por fila)
- Test: `lib/etl/normalizers/compras.test.ts:72-80` (test existente a actualizar), agregar casos nuevos

**Interfaces:**
- Consumes: `resolveProveedorId(codigoFila: string | null, textoProveedor: string | null, provMap: Map<string, ProveedorCandidato>): number | null` y `ProveedorCandidato` de Task 1 (`./proveedor-match`).

- [ ] **Step 1: Escribir/actualizar los tests que fallan**

Reemplazar el test existente "resuelve proveedorId consultando proveedores por CODIGO" (líneas 72-80 de `lib/etl/normalizers/compras.test.ts`) y agregar los casos de mismatch/null, usando el mismo patrón de introspección de `$executeRaw` que ya usa `lib/etl/normalizers/ventas.test.ts:91-92` (`COLUMNS_PER_ROW`):

```ts
// Reemplaza el test "resuelve proveedorId consultando proveedores por CODIGO" existente.
// Índice 16 = columna "proveedorId" en el INSERT de compras.ts (20 columnas por fila,
// mismo criterio de introspección de $executeRaw que ventas.test.ts:91-92).

it("resuelve proveedorId cuando el texto crudo coincide con el nombre del proveedor", async () => {
  const proveedorModel = {
    findMany: vi.fn().mockResolvedValue([{ id: 5, codigo: "PROV1", nombre: "Juan Perez", razon: null }]),
  };
  const db = createMockDb({ proveedor: proveedorModel });
  const res = await normalizeCompras([baseRow({ CODIGO: "PROV1", PROVEEDOR: "Juan Perez" })], db);
  expect(proveedorModel.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { codigo: { in: ["PROV1"] } },
      select: { id: true, codigo: true, nombre: true, razon: true },
    })
  );
  expect(res.created).toBe(1);
  expect(res.errors).toHaveLength(0);
  const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
  expect(call.values[16]).toBe(5); // columna proveedorId
});

it("CODIGO coincide con un proveedor real pero el texto crudo no matchea (cruce, ver bug Diego/Creacion Tm Sr): proveedorId queda null", async () => {
  const proveedorModel = {
    findMany: vi.fn().mockResolvedValue([{ id: 46893, codigo: "309", nombre: "Creacion Tm Sr", razon: null }]),
  };
  const db = createMockDb({ proveedor: proveedorModel });
  const res = await normalizeCompras(
    [baseRow({ CODIGO: "309", PROVEEDOR: "Diego", COD_CGA: "307", CONCEPTO: "B. Liquidacion De Sueldo" })],
    db
  );
  expect(res.created).toBe(1);
  expect(res.errors).toHaveLength(0);
  const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
  expect(call.values[16]).toBeNull();
});

it("PROVEEDOR null en la fila: sin texto para contradecir, se mantiene el proveedorId resuelto por código", async () => {
  const proveedorModel = {
    findMany: vi.fn().mockResolvedValue([{ id: 7, codigo: "PROV1", nombre: "Cualquiera", razon: null }]),
  };
  const db = createMockDb({ proveedor: proveedorModel });
  const res = await normalizeCompras([baseRow({ CODIGO: "PROV1", PROVEEDOR: null })], db);
  expect(res.created).toBe(1);
  const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
  expect(call.values[16]).toBe(7);
});
```

- [ ] **Step 2: Correr los tests, verificar que fallan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: FAIL — el test de mismatch espera `null` pero el código actual todavía resuelve por código sin validar texto (`call.values[16]` sería `46893`, no `null`); el test de `select` con `nombre`/`razon` falla porque el select actual no los pide.

- [ ] **Step 3: Implementación**

En `lib/etl/normalizers/compras.ts`, importar el helper:

```ts
import { resolveProveedorId, type ProveedorCandidato } from "./proveedor-match";
```

Reemplazar el bloque de lookup de proveedores y el guard de Gastos En Personal (líneas 148-173 actuales) por:

```ts
  // Lookup tables — una sola query cada una para todo el archivo
  const codigosProv = [...new Set(filtered.map((pr) => pr.data.CODIGO).filter((v): v is string => v != null))];
  const provMap = new Map<string, ProveedorCandidato>(
    (await prisma.proveedor.findMany({
      where: { codigo: { in: codigosProv } },
      select: { id: true, codigo: true, nombre: true, razon: true },
    })).map((p) => [p.codigo, { id: p.id, nombre: p.nombre, razon: p.razon }])
  );

  const codigosConcepto = [...new Set(filtered.map((pr) => pr.data.COD_CGA).filter((v): v is string => v != null))];
  const conceptoSet = new Set(
    (await prisma.conceptoCaja.findMany({
      where: { codigo: { in: codigosConcepto } },
      select: { codigo: true },
    })).map((c) => c.codigo)
  );
```

(Esto elimina `conceptosInfo` y `codigosGastoPersonal` — el `CODIGO` de la fila ya no se confía por nombre de concepto/rubro, sino por si el texto crudo coincide con el proveedor candidato, para **cualquier** concepto.)

Reemplazar la resolución de `proveedorId` por fila (líneas 198-200 actuales):

```ts
      const rowValues = chunk.map(({ rowId, row, data }) => {
        const proveedorId = resolveProveedorId(data.CODIGO, data.PROVEEDOR, provMap);
        const conceptoCodigo = conceptoSet.has(data.COD_CGA) ? data.COD_CGA : null;
```

- [ ] **Step 4: Correr los tests, verificar que pasan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: PASS (todos, incluidos los 3 nuevos/actualizados)

- [ ] **Step 5: Correr toda la suite del ETL para descartar regresiones**

Run: `npx vitest run lib/etl`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/etl/normalizers/compras.ts lib/etl/normalizers/compras.test.ts
git commit -m "fix(etl): reemplaza el whitelist de Gastos En Personal por validación de texto transversal"
```

---

## Task 3: `detalle-compras.ts` deja de resolver `proveedorId` de forma independiente

**Files:**
- Modify: `lib/etl/normalizers/detalle-compras.ts:95-101` (lookup `provMapDet`, a eliminar), `lib/etl/normalizers/detalle-compras.ts:122` (resolución por fila)
- Test: `lib/etl/normalizers/detalle-compras.test.ts` (agregar caso nuevo)

**Interfaces:**
- No consume nada de Tasks 1/2 — `detalle_compras` no tiene campo de texto de proveedor contra el cual validar (spec §3.3), así que no aplica `proveedorTextoCoincide` acá.

- [ ] **Step 1: Escribir el test que falla**

```ts
// agregar a lib/etl/normalizers/detalle-compras.test.ts
it("proveedorId siempre queda null (no hay texto de proveedor en esta tabla para validar el código, ver spec cruce-proveedorid)", async () => {
  const proveedorModel = { findMany: vi.fn().mockResolvedValue([{ id: 5, codigo: "PROV1" }]) };
  const db = createMockDb({ proveedor: proveedorModel });
  const res = await normalizeDetalleCompras([baseRow({ COD_PRO: "PROV1" })], db);
  expect(res.created).toBe(1);
  expect(proveedorModel.findMany).not.toHaveBeenCalled();
  const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
  expect(call.values[21]).toBeNull(); // columna proveedorId
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `npx vitest run lib/etl/normalizers/detalle-compras.test.ts`
Expected: FAIL — `proveedorModel.findMany` sí se llama hoy (se elimina en el Step 3), y `call.values[21]` hoy sería `5`, no `null`.

- [ ] **Step 3: Implementación**

En `lib/etl/normalizers/detalle-compras.ts`, eliminar el bloque de lookup de proveedores (líneas 95-101 actuales):

```ts
  const codigosProvDet = [...new Set(filtered.map((pr) => pr.data.COD_PRO).filter((v): v is string => v != null))];
  const provMapDet = new Map(
    (await prisma.proveedor.findMany({
      where: { codigo: { in: codigosProvDet } },
      select: { id: true, codigo: true },
    })).map((p) => [p.codigo, p.id])
  );
```

Reemplazar la resolución por fila (línea 122 actual):

```ts
        // proveedorId nunca se resuelve acá de forma independiente: esta tabla no
        // tiene un campo de texto de proveedor contra el cual validar el CODIGO
        // (a diferencia de compras.ts) — ver spec 2026-09-19-cruce-proveedorid-compras-design.md §3.3.
        const proveedorId = null;
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `npx vitest run lib/etl/normalizers/detalle-compras.test.ts`
Expected: PASS

- [ ] **Step 5: Correr toda la suite del ETL**

Run: `npx vitest run lib/etl`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/etl/normalizers/detalle-compras.ts lib/etl/normalizers/detalle-compras.test.ts
git commit -m "fix(etl): detalle_compras deja de resolver proveedorId sin datos para validarlo"
```

---

## Task 4: Script de backfill — `scripts/fix-proveedorid-cruzado.ts`

**Files:**
- Create: `scripts/fix-proveedorid-cruzado.ts`
- Test: `scripts/fix-proveedorid-cruzado.test.ts`

**Interfaces:**
- Consumes: `proveedorTextoCoincide` de `lib/etl/normalizers/proveedor-match.ts` (Task 1).
- Produces: `export interface CompraParaFix { rowId: string; proveedor: string | null; proveedorNombre: string | null; proveedorRazon: string | null; }`, `export interface PlanFixProveedor { rowIdANulificar: string[]; }`, `export function planFixProveedorCruzado(compras: CompraParaFix[]): PlanFixProveedor`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// scripts/fix-proveedorid-cruzado.test.ts
import { describe, it, expect } from "vitest";
import { planFixProveedorCruzado, type CompraParaFix } from "./fix-proveedorid-cruzado";

function fila(overrides: Partial<CompraParaFix> = {}): CompraParaFix {
  return {
    rowId: "row-1",
    proveedor: "Juan Perez",
    proveedorNombre: "Juan Perez",
    proveedorRazon: null,
    ...overrides,
  };
}

describe("planFixProveedorCruzado", () => {
  it("texto coincide con el nombre actual: no se nulifica", () => {
    const plan = planFixProveedorCruzado([fila()]);
    expect(plan.rowIdANulificar).toHaveLength(0);
  });

  it("texto coincide solo con razon: no se nulifica", () => {
    const plan = planFixProveedorCruzado([
      fila({ proveedorNombre: "Distinto", proveedorRazon: "Juan Perez" }),
    ]);
    expect(plan.rowIdANulificar).toHaveLength(0);
  });

  it("caso real de regresión (Diego/Creacion Tm Sr): se nulifica", () => {
    const plan = planFixProveedorCruzado([
      fila({ rowId: "row-diego", proveedor: "Diego", proveedorNombre: "Creacion Tm Sr", proveedorRazon: null }),
    ]);
    expect(plan.rowIdANulificar).toEqual(["row-diego"]);
  });

  it("texto null: no se nulifica (sin evidencia en contra)", () => {
    const plan = planFixProveedorCruzado([fila({ proveedor: null, proveedorNombre: "Cualquiera" })]);
    expect(plan.rowIdANulificar).toHaveLength(0);
  });

  it("mezcla de filas: solo las que no matchean van a rowIdANulificar", () => {
    const plan = planFixProveedorCruzado([
      fila({ rowId: "ok-1" }),
      fila({ rowId: "cruzada-1", proveedor: "Facundo", proveedorNombre: "Fiestisima" }),
      fila({ rowId: "ok-2", proveedor: null }),
      fila({ rowId: "cruzada-2", proveedor: "GASTOS VARIOS", proveedorNombre: "Prosegur" }),
    ]);
    expect(plan.rowIdANulificar).toEqual(["cruzada-1", "cruzada-2"]);
  });
});
```

- [ ] **Step 2: Correr los tests, verificar que fallan**

Run: `npx vitest run scripts/fix-proveedorid-cruzado.test.ts`
Expected: FAIL — `Cannot find module './fix-proveedorid-cruzado'`

- [ ] **Step 3: Implementación — función pura + CLI**

```ts
// scripts/fix-proveedorid-cruzado.ts
/**
 * fix-proveedorid-cruzado.ts
 *
 * Corrige compras cuyo proveedorId quedó linkeado a un proveedor incorrecto por
 * colisión de código (ver docs/superpowers/specs/2026-09-19-cruce-proveedorid-compras-design.md).
 * El ETL ya corta la causa para futuros imports (lib/etl/normalizers/compras.ts) —
 * este script corrige las filas que ya quedaron mal linkeadas en producción.
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar contra la base real.
 *
 * Uso:
 *   npx tsx scripts/fix-proveedorid-cruzado.ts             # dry-run
 *   npx tsx scripts/fix-proveedorid-cruzado.ts --apply      # aplica de verdad
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { proveedorTextoCoincide } from "../lib/etl/normalizers/proveedor-match";

const SCRATCHPAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "fix-proveedorid-cruzado");

export interface CompraParaFix {
  rowId: string;
  proveedor: string | null;
  proveedorNombre: string | null;
  proveedorRazon: string | null;
}

export interface PlanFixProveedor {
  rowIdANulificar: string[];
}

// Función pura, testable sin base de datos real — separa "qué hay que
// corregir" de "cómo se aplica la corrección" (mismo criterio que
// planCleanupDuplicados en cleanup-duplicados-compras.ts).
export function planFixProveedorCruzado(compras: CompraParaFix[]): PlanFixProveedor {
  const rowIdANulificar = compras
    .filter((c) => !proveedorTextoCoincide(c.proveedor, { nombre: c.proveedorNombre, razon: c.proveedorRazon }))
    .map((c) => c.rowId);
  return { rowIdANulificar };
}

interface CompraDbRow {
  rowId: string;
  proveedor: string | null;
  importe: { toString(): string } | null;
  fecha: Date | null;
  proveedorRef: { nombre: string | null; razon: string | null } | null;
}

const SELECT_COMPRA = {
  rowId: true,
  proveedor: true,
  importe: true,
  fecha: true,
  proveedorRef: { select: { nombre: true, razon: true } },
} as const;

function aCompraParaFix(c: CompraDbRow): CompraParaFix {
  return {
    rowId: c.rowId,
    proveedor: c.proveedor,
    proveedorNombre: c.proveedorRef?.nombre ?? null,
    proveedorRazon: c.proveedorRef?.razon ?? null,
  };
}

async function exportarDetalle(rowIds: string[], porRowId: Map<string, CompraDbRow>, archivo: string) {
  const detalle = rowIds.map((rowId) => {
    const c = porRowId.get(rowId)!;
    return {
      rowId: c.rowId,
      proveedorTextoCrudo: c.proveedor,
      proveedorNombreActual: c.proveedorRef?.nombre ?? null,
      importe: c.importe != null ? c.importe.toString() : null,
      fecha: c.fecha,
    };
  });
  const fs = await import("fs");
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(detalle, null, 2));
  return archivo;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const compras: CompraDbRow[] = await prisma.compra.findMany({
    where: { proveedorId: { not: null } },
    select: SELECT_COMPRA,
  });
  const plan = planFixProveedorCruzado(compras.map(aCompraParaFix));
  const porRowId = new Map(compras.map((c) => [c.rowId, c]));

  console.log(`\n=== Plan de corrección de proveedorId cruzado (${apply ? "aplicando" : "dry-run"}) ===`);
  console.log(`Compras con proveedorId asignado: ${compras.length}`);
  console.log(`Filas a poner en null (cruzadas): ${plan.rowIdANulificar.length}`);

  const archivoDryRun = await exportarDetalle(plan.rowIdANulificar, porRowId, `${SCRATCHPAD_DIR}/fix-proveedorid-dry-run.json`);
  console.log(`Detalle exportado a ${archivoDryRun}`);

  if (!apply) {
    console.log("\nDry-run — no se escribió nada en la base. Re-ejecutar con --apply para aplicar.\n");
    return;
  }

  console.log("\nAplicando...");

  // Recálculo en vivo — nunca se reusa el plan de arriba, por si algo cambió
  // la base entre el arranque del script y este punto (mismo criterio que
  // cleanup-duplicados-compras.ts).
  const comprasEnVivo: CompraDbRow[] = await prisma.compra.findMany({
    where: { proveedorId: { not: null } },
    select: SELECT_COMPRA,
  });
  const planEnVivo = planFixProveedorCruzado(comprasEnVivo.map(aCompraParaFix));
  const porRowIdEnVivo = new Map(comprasEnVivo.map((c) => [c.rowId, c]));

  if (planEnVivo.rowIdANulificar.length !== plan.rowIdANulificar.length) {
    throw new Error(
      `Plan cambió entre el resumen mostrado y la ejecución: ` +
        `se esperaba corregir ${plan.rowIdANulificar.length} filas, ` +
        `pero el recálculo en vivo encontró ${planEnVivo.rowIdANulificar.length}`
    );
  }

  if (planEnVivo.rowIdANulificar.length === 0) {
    console.log("\nNo hay nada para corregir.\n");
    return;
  }

  const { cantidadActualizada } = await prisma.$transaction(
    async (tx) => {
      const candidatasAhora = await tx.compra.count({
        where: { rowId: { in: planEnVivo.rowIdANulificar }, proveedorId: { not: null } },
      });
      if (candidatasAhora !== planEnVivo.rowIdANulificar.length) {
        throw new Error(
          `Verificación falló: ${planEnVivo.rowIdANulificar.length} filas candidatas esperadas, ` +
            `${candidatasAhora} encontradas justo antes de aplicar — alguna cambió entremedio.`
        );
      }

      const resultado = await tx.compra.updateMany({
        where: { rowId: { in: planEnVivo.rowIdANulificar } },
        data: { proveedorId: null },
      });
      if (resultado.count !== planEnVivo.rowIdANulificar.length) {
        throw new Error(
          `Verificación falló: se esperaba corregir ${planEnVivo.rowIdANulificar.length} filas, se actualizaron ${resultado.count}`
        );
      }

      return { cantidadActualizada: resultado.count };
    },
    { timeout: 30000, maxWait: 20000 }
  );

  const archivoAplicado = await exportarDetalle(
    planEnVivo.rowIdANulificar,
    porRowIdEnVivo,
    `${SCRATCHPAD_DIR}/fix-proveedorid-aplicado.json`
  );

  console.log(`\n=== Verificación post-corrección ===`);
  console.log(`Filas corregidas (proveedorId → null): ${cantidadActualizada}`);
  console.log(`Detalle de lo corregido exportado a ${archivoAplicado}`);
  console.log("\nCorrección completada y verificada.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
```

- [ ] **Step 4: Correr los tests, verificar que pasan**

Run: `npx vitest run scripts/fix-proveedorid-cruzado.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add scripts/fix-proveedorid-cruzado.ts scripts/fix-proveedorid-cruzado.test.ts
git commit -m "feat(scripts): backfill para corregir proveedorId cruzado en compras ya importadas"
```

---

## Task 5: Ejecutar el backfill contra producción

**No dispatchable a subagente — ver nota al principio del plan.** Se ejecuta en la conversación principal, con el usuario presente.

**Files:** ninguno (solo comandos + datos reales)

- [ ] **Step 1: Dry-run**

Run: `npx tsx scripts/fix-proveedorid-cruzado.ts`

Revisar la salida con el usuario: la línea exacta `Filas a poner en null (cruzadas): <N>` (el diagnóstico del 19-sep estimó ~2.164 filas, pero ese número se midió con la normalización de texto previa al fix de acentos de la revisión final — el fix de acentos es más permisivo, así que el dry-run real puede dar un número **igual o algo menor**; eso es esperado, no drift) y el archivo JSON exportado en `tmp/fix-proveedorid-cruzado/fix-proveedorid-dry-run.json` para que el usuario pueda auditar una muestra.

Mirar también la línea `Candidatas con distribución activa (esDistribuido=true)`. Esperado: `0`.

- [ ] **Step 2: Confirmación explícita del usuario**

Presentar el conteo del dry-run y pedir confirmación explícita antes de aplicar (CLAUDE.md §7 — dato financiero real). No continuar sin un "sí" explícito a este paso puntual.

**Condición de parada:** si `Candidatas con distribución activa` es distinto de `0`, no seguir. Esas compras ya tienen plata repartida en `distribuciones_apertura` por una regla de Apertura de Gastos de nivel proveedor; nulificarles el `proveedorId` dejaría esas distribuciones huérfanas. El `--apply` aborta solo en ese caso (guard duro, sin bypass), así que esto es solo para saber qué esperar: hay que mirar las filas concretas y decidir manualmente con el usuario antes de reintentar.

**Anotar el número confirmado** de la línea `Filas a poner en null (cruzadas):` — de acá en adelante `N` — para usarlo en el Step 4. No usar el total de "Compras con proveedorId asignado" (esa es la población de entrada, no lo que se va a corregir).

- [ ] **Step 3: Backup**

Run: `pg_dump -Fc "$DIRECT_URL" -f tmp/fix-proveedorid-cruzado/backup-pre-fix-$(date +%Y%m%d-%H%M%S).dump`

Verificar el backup: `pg_restore --list tmp/fix-proveedorid-cruzado/backup-pre-fix-*.dump | head`
Expected: lista de objetos del dump sin error.

- [ ] **Step 4: Aplicar**

Run: `npx tsx scripts/fix-proveedorid-cruzado.ts --apply --esperadas=<N>`

`<N>` es el número de filas confirmado por el usuario en el Step 2 (ej. `--esperadas=2164`). El flag no es opcional en este runbook: sin él, un import que corra entre el dry-run aprobado y este comando haría que `--apply` corrija una cantidad distinta a la que el humano revisó, sin que nada lo detecte. Con el flag, el script aborta sin escribir nada si el recálculo en vivo no da exactamente `N`.

Expected: "Corrección completada y verificada." con `cantidadActualizada` igual a `N`. Antes de la transacción imprime también la pre-imagen exportada a `tmp/fix-proveedorid-cruzado/fix-proveedorid-pre-apply.json` (red de seguridad para deshacer de forma quirúrgica si el proceso cae después del commit).

**Nota:** que exista `fix-proveedorid-pre-apply.json` no dice si el commit llegó a pasar o no (se escribe antes de abrir la transacción) — para confirmar que se aplicó, mirar el mensaje final ("Corrección completada y verificada.") y que exista `fix-proveedorid-aplicado.json`. Si el proceso corta a mitad de camino sin ese mensaje ni ese archivo, verificar con una query de solo lectura si el `UPDATE` llegó a commitear antes de decidir si hay que reintentar.

- [ ] **Step 5: Verificación post-aplicación con el usuario**

Confirmar con una query de solo lectura que el caso original del reporte (compra de "Diego", concepto "B. Liquidacion De Sueldo") ya no muestra "Creacion Tm Sr" en la vista Compras x Proveedor. Pedir al usuario que verifique visualmente en el dashboard.

---

## Self-Review

**1. Cobertura del spec:** §3.1 (helper de validación) → Task 1. §3.2 (`compras.ts`) → Task 2. §3.3 (`detalle-compras.ts`) → Task 3. §3.4 (backfill) → Tasks 4-5. §4 (testing) → cubierto en cada task. Sin gaps.

**2. Placeholders:** ninguno — todos los steps tienen código real, comandos reales o texto de commit real.

**3. Consistencia de tipos:** `ProveedorCandidato` (Task 1) se usa igual en Task 2 (`provMap: Map<string, ProveedorCandidato>`) y Task 4 (`{ nombre: c.proveedorNombre, razon: c.proveedorRazon }`, mismo shape). `resolveProveedorId` y `proveedorTextoCoincide` mantienen firma idéntica entre Tasks 1, 2 y 4. Índices de columna (`values[16]` en compras, `values[21]` en detalle_compras) verificados contra el orden real de columnas del INSERT de cada archivo.
