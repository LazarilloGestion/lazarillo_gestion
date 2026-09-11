# Vista de Compras por Proveedor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una segunda forma de agrupar el pivot de Compras — `Proveedor → Concepto de caja → línea de compra` — seleccionable con un toggle, sin tocar el motor de reglas de apertura ni el schema de Prisma.

**Architecture:** El endpoint `/api/dashboard/pivot` ya trae, por cada línea de compra, rubro/concepto/proveedor en la misma fila SQL. Se agrega una segunda función pura que arma el árbol agrupando por proveedor en vez de por rubro, a partir de esas mismas filas — sin queries SQL nuevas para el árbol en sí. La composición del tooltip de apertura se extiende para poder indexarse también por proveedor. En el cliente, `PivotTable` se convierte en un switcher liviano entre dos componentes de presentación (`PivotTableByConcepto`, ya existente y renombrado sin cambios de lógica; `PivotTableByProveedor`, nuevo).

**Tech Stack:** Next.js 16 (App Router, Route Handlers), TypeScript estricto, Prisma 7 (`$queryRaw` con `Prisma.sql`), Zustand (`dashboard-store`), TanStack Query (`useFetchQuery`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-vista-compras-por-proveedor-design.md`

## Global Constraints

- TypeScript en modo estricto; nada de `any` sin justificación en comentario.
- Manejo de errores explícito — nunca `catch {}` vacío.
- Funciones puras donde sea posible; separar UI / lógica / acceso a datos.
- No agregar dependencias nuevas sin preguntar primero.
- No modificar código fuera del alcance de esta feature (no tocar el motor de reglas de apertura, no tocar el schema de Prisma — no hay migración en este plan).
- TDD para toda función pura nueva (test primero, ver fallar, implementar, ver pasar).
- Diffs pequeños e incrementales — un commit por task.
- Correr `npm run lint` y `npm run test` antes de dar cualquier task por cerrada; correr `npm run build` al final del plan.
- Nombres de dominio en español, consistente con el resto del repo (`proveedor`, `concepto`, `linea`, `agrupacion`).
- Esta feature es de solo lectura sobre datos de compras ya importados (no crea, modifica ni borra registros de compras/ventas) — no dispara la regla de "preguntar antes de ejecutar" de CLAUDE.md §7 para cambios sobre esos datos, pero cualquier desvío del plan sí debe avisarse antes de improvisar.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `lib/dashboard/types.ts` | Modificar | Tipos del árbol nuevo: `PivotLineaRow`, `PivotConceptoSubRow`, `PivotProveedorTopRow`, `PivotDataPorProveedor` |
| `lib/dashboard/constants.ts` | Modificar | Sentinel `SIN_PROVEEDOR_KEY` |
| `lib/dashboard/apertura-composicion.ts` + `.test.ts` | Modificar | `buildComposicionPorProveedor`, extender tipos de fila SQL con `proveedor_id` |
| `lib/dashboard/pivot-por-proveedor.ts` + `.test.ts` | Crear | `buildPivotDataByProveedor` — arma el árbol proveedor→concepto→línea |
| `lib/dashboard/pivot-utils.ts` + `.test.ts` | Modificar / Crear | `sortPivotRowsPorProveedor`, `flattenRowsPorProveedor`, tipo `FlatRowPorProveedor` |
| `lib/dashboard/params.ts` + `.test.ts` | Modificar | Parseo/armado de la query `agrupacion` |
| `app/api/dashboard/pivot/route.ts` | Modificar | Rama por `agrupacion`, `proveedor_id` en las queries de composición |
| `hooks/use-dashboard-store.ts` | Modificar | Estado `agrupacionCompras` (persistido) |
| `hooks/use-operacion-kpis.ts` | Modificar | Genérico sobre el tipo de árbol devuelto, threading de `agrupacion` |
| `hooks/use-pivot-screen-data-por-proveedor.ts` | Crear | Expand/collapse/sort/flatten/detalle para el árbol por proveedor |
| `components/dashboard/dashboard-filters.tsx` | Modificar | Toggle "Ver por: Concepto \| Proveedor" |
| `components/dashboard/pivot-table-por-concepto.tsx` | Crear (mover) | Contenido actual de `pivot-table.tsx`, sin cambios de lógica |
| `components/dashboard/pivot-table-por-proveedor.tsx` | Crear | Presentación del árbol por proveedor |
| `components/dashboard/pivot-table.tsx` | Reescribir | Switcher liviano entre los dos anteriores |

---

### Task 1: Tipos del árbol por proveedor

**Files:**
- Modify: `lib/dashboard/types.ts`
- Modify: `lib/dashboard/constants.ts`

**Interfaces:**
- Produces: `PivotLineaRow`, `PivotConceptoSubRow`, `PivotProveedorTopRow`, `PivotDataPorProveedor` (todos exportados desde `lib/dashboard/types.ts`); `SIN_PROVEEDOR_KEY: string` (exportado desde `lib/dashboard/constants.ts`).

- [ ] **Step 1: Agregar el sentinel a `constants.ts`**

Agregar al final de `lib/dashboard/constants.ts`:

```ts
// Clave sintética para agrupar compras sin proveedor asignado en el árbol
// "por proveedor" — análoga a SIN_RUBRO_CODE/SIN_CONCEPTO_CODE de arriba,
// pero el id de proveedor es numérico (FK nullable), no un código de texto,
// así que no hay valor numérico "mágico" que reusar como con rubro/concepto.
export const SIN_PROVEEDOR_KEY = "__sin_proveedor";
```

- [ ] **Step 2: Agregar los tipos nuevos a `types.ts`**

Agregar después del bloque `// --- Pivot row types ...` existente (después de `PivotData`, línea ~61 del archivo actual):

```ts
// --- Pivot row types "por proveedor" (Proveedor → Concepto → línea) ---
// Tipos paralelos a PivotRubroRow/PivotConceptoRow/PivotProveedorRow de
// arriba, no reutilizados: forzar otro significado en `rubroCodigo` (p. ej.
// guardar ahí un proveedorId) sería confuso. Es la 2ª repetición de este
// patrón de árbol de 3 niveles — si aparece una 3ª forma de agrupar, ahí sí
// vale la pena generalizar (ver docs/superpowers/specs/2026-09-11-vista-compras-por-proveedor-design.md §3.1).

export type PivotLineaRow = {
  readonly level: 2;
  readonly id: string;
  readonly rowId: string;
  readonly distribucionId: number | null;
  readonly conceptoCodigo: string;
  readonly fecha: string | null;
  readonly observac: string | null;
  readonly importe: number;
  readonly hasManualOverride: boolean;
  values: Record<number, number>;
  rowTotal: number;
};

export type PivotConceptoSubRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotLineaRow[];
  composicion?: Record<number, ComposicionMes>;
};

export type PivotProveedorTopRow = {
  readonly level: 0;
  readonly id: string;
  readonly nombre: string;
  readonly proveedorId: number | null;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoSubRow[];
};

export type PivotDataPorProveedor = {
  rows: PivotProveedorTopRow[];
  columnTotals: Record<number, number>;
  grandTotal: number;
};
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos relacionados a `types.ts` (los tipos nuevos no se usan todavía en ningún lado, así que no debería haber ni un error de "unused").

- [ ] **Step 4: Commit**

```bash
git add lib/dashboard/types.ts lib/dashboard/constants.ts
git commit -m "feat(dashboard): tipos del árbol de compras por proveedor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `buildComposicionPorProveedor`

**Files:**
- Modify: `lib/dashboard/apertura-composicion.ts`
- Test: `lib/dashboard/apertura-composicion.test.ts`

**Interfaces:**
- Consumes: `SIN_PROVEEDOR_KEY` de `./constants` (Task 1).
- Produces: `buildComposicionPorProveedor(destinoRows: ComposicionSqlRow[], originalRows: ComposicionOriginalRow[]): Record<string, Record<number, ComposicionMes>>` — clave `` `${conceptoCodigo}|${proveedorId ?? SIN_PROVEEDOR_KEY}` ``. `ComposicionSqlRow` y `ComposicionOriginalRow` ganan el campo `proveedor_id: number | null`.

- [ ] **Step 1: Escribir los tests que fallan**

Cambiar la línea de import existente al tope de `lib/dashboard/apertura-composicion.test.ts` (`import { buildComposicion } from "./apertura-composicion";`) por:

```ts
import { buildComposicion, buildComposicionPorProveedor } from "./apertura-composicion";
```

No agregar una segunda línea de `import` — se extiende la existente. Luego, agregar al final del archivo (después del `describe("buildComposicion", ...)` existente, que no se toca) un `describe` nuevo:

```ts
describe("buildComposicionPorProveedor", () => {
  it("agrupa por concepto+proveedor+mes, sin mezclar proveedores", () => {
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 1, mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 700 },
      { concepto_codigo: "17", proveedor_id: 2, mes: 5, destino_nombre: "Actual", pct: 50, importe_calculado: 500 },
    ];
    const originalRows = [
      { concepto_codigo: "17", proveedor_id: 1, mes: 5, importe_original: 1000 },
      { concepto_codigo: "17", proveedor_id: 2, mes: 5, importe_original: 1000 },
    ];
    const result = buildComposicionPorProveedor(destinoRows, originalRows);

    expect(result["17|1"][5].total).toBe(1000);
    expect(result["17|1"][5].destinos).toEqual([{ nombre: "Actual", pct: 70, importe: 700 }]);
    expect(result["17|2"][5].destinos).toEqual([{ nombre: "Actual", pct: 50, importe: 500 }]);
  });

  it("proveedor_id null usa la clave __sin_proveedor", () => {
    const result = buildComposicionPorProveedor(
      [{ concepto_codigo: "3", proveedor_id: null, mes: 1, destino_nombre: "X", pct: 100, importe_calculado: 500 }],
      [{ concepto_codigo: "3", proveedor_id: null, mes: 1, importe_original: 500 }]
    );
    expect(result["3|__sin_proveedor"][1].total).toBe(500);
  });

  it("no afecta a buildComposicion existente (sigue agrupando solo por concepto)", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "17", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 700 }],
      [{ concepto_codigo: "17", mes: 5, importe_original: 1000 }]
    );
    expect(result["17"][5].total).toBe(1000);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/dashboard/apertura-composicion.test.ts`
Expected: FAIL — `buildComposicionPorProveedor` no existe todavía (`SyntaxError` o `TypeError: buildComposicionPorProveedor is not a function`).

- [ ] **Step 3: Implementar**

En `lib/dashboard/apertura-composicion.ts`, agregar el import del sentinel y extender los dos tipos de fila:

```ts
import { SIN_PROVEEDOR_KEY } from "./constants";
```

Cambiar:

```ts
export type ComposicionSqlRow = {
  concepto_codigo: string;
  mes: number;
  destino_nombre: string;
  pct: DecimalLike;
  importe_calculado: DecimalLike;
};

export type ComposicionOriginalRow = {
  concepto_codigo: string;
  mes: number;
  importe_original: DecimalLike;
};
```

por:

```ts
export type ComposicionSqlRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  mes: number;
  destino_nombre: string;
  pct: DecimalLike;
  importe_calculado: DecimalLike;
};

export type ComposicionOriginalRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  mes: number;
  importe_original: DecimalLike;
};
```

Agregar al final del archivo, después de `buildComposicion`:

```ts
// Misma idea que buildComposicion, pero indexada también por proveedor: el
// tooltip de la vista "por Proveedor" necesita el reparto de ESE proveedor en
// ESE concepto, no el total cruzando todos los proveedores del concepto (que
// es lo que devuelve buildComposicion) — ver spec §3.3.
export function buildComposicionPorProveedor(
  destinoRows: ComposicionSqlRow[],
  originalRows: ComposicionOriginalRow[]
): Record<string, Record<number, ComposicionMes>> {
  const out: Record<string, Record<number, ComposicionMes>> = {};

  const key = (concepto: string, proveedorId: number | null) =>
    `${concepto}|${proveedorId ?? SIN_PROVEEDOR_KEY}`;

  const ensure = (concepto: string, proveedorId: number | null, mes: number): ComposicionMes => {
    const k = key(concepto, proveedorId);
    out[k] ??= {};
    out[k][mes] ??= { total: 0, destinos: [] };
    return out[k][mes];
  };

  for (const row of originalRows) {
    ensure(row.concepto_codigo, row.proveedor_id, row.mes).total += toNum(row.importe_original);
  }
  for (const row of destinoRows) {
    ensure(row.concepto_codigo, row.proveedor_id, row.mes).destinos.push({
      nombre: row.destino_nombre,
      pct: toNum(row.pct),
      importe: toNum(row.importe_calculado),
    });
  }
  return out;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/dashboard/apertura-composicion.test.ts`
Expected: PASS — los 3 tests nuevos y los 3 existentes (sin tocar).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/apertura-composicion.ts lib/dashboard/apertura-composicion.test.ts
git commit -m "feat(dashboard): buildComposicionPorProveedor — tooltip de apertura scoped por proveedor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `buildPivotDataByProveedor`

**Files:**
- Create: `lib/dashboard/pivot-por-proveedor.ts`
- Test: `lib/dashboard/pivot-por-proveedor.test.ts`

**Interfaces:**
- Consumes: `SqlRow`, `ComposicionMes`, `PivotDataPorProveedor`, `PivotProveedorTopRow`, `PivotConceptoSubRow`, `PivotLineaRow` de `./types` (Task 1); `SIN_PROVEEDOR_KEY` de `./constants` (Task 1).
- Produces: `buildPivotDataByProveedor(sqlRows: SqlRow[], composicionPorProveedor: Record<string, Record<number, ComposicionMes>>): PivotDataPorProveedor`.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/dashboard/pivot-por-proveedor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPivotDataByProveedor } from "./pivot-por-proveedor";
import type { SqlRow } from "./types";

function row(overrides: Partial<SqlRow>): SqlRow {
  return {
    rubro_codigo: "R1", rubro_nombre: "Rubro 1",
    concepto_codigo: "C1", concepto_nombre: "Concepto 1",
    proveedor_id: 1, proveedor_nombre: "Proveedor A",
    mes: 1, total: 100, row_id: "row-1", distribucion_id: null,
    fecha: "2026-01-01", observac: null, has_manual_override: false,
    ...overrides,
  };
}

describe("buildPivotDataByProveedor", () => {
  it("agrupa por proveedor y luego por concepto, sin mezclar proveedores", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, proveedor_nombre: "Proveedor A", concepto_codigo: "C1", row_id: "a1", total: 100 }),
      row({ proveedor_id: 2, proveedor_nombre: "Proveedor B", concepto_codigo: "C1", row_id: "b1", total: 200 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});

    expect(data.rows).toHaveLength(2);
    const provA = data.rows.find((p) => p.proveedorId === 1)!;
    const provB = data.rows.find((p) => p.proveedorId === 2)!;
    expect(provA.rowTotal).toBe(100);
    expect(provB.rowTotal).toBe(200);
    expect(provA.children).toHaveLength(1);
    expect(provA.children[0].conceptoCodigo).toBe("C1");
    expect(provA.children[0].rowTotal).toBe(100);
  });

  it("rollup mensual correcto en el nivel proveedor y en los totales generales", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", mes: 1, total: 100 }),
      row({ proveedor_id: 1, concepto_codigo: "C2", concepto_nombre: "Concepto 2", row_id: "a2", mes: 1, total: 50 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const provA = data.rows[0];
    expect(provA.values[1]).toBe(150);
    expect(provA.rowTotal).toBe(150);
    expect(data.columnTotals[1]).toBe(150);
    expect(data.grandTotal).toBe(150);
  });

  it("proveedor null usa la clave __sin_proveedor sin romper", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "Sin Proveedor", row_id: "x1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    expect(data.rows[0].proveedorId).toBeNull();
    expect(data.rows[0].id).toBe("__sin_proveedor");
  });

  it("adjunta la composición correspondiente a cada concepto+proveedor", () => {
    const rows: SqlRow[] = [row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1" })];
    const composicion = { "C1|1": { 1: { total: 100, destinos: [{ nombre: "Local A", pct: 100, importe: 100 }] } } };
    const data = buildPivotDataByProveedor(rows, composicion);
    expect(data.rows[0].children[0].composicion).toEqual(composicion["C1|1"]);
  });

  it("dos líneas de la misma compra distribuida no colisionan de id", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", distribucion_id: 10, total: 60 }),
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", distribucion_id: 11, total: 40 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const lineaIds = data.rows[0].children[0].children.map((l) => l.id);
    expect(new Set(lineaIds).size).toBe(2);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: FAIL — el módulo `./pivot-por-proveedor` no existe.

- [ ] **Step 3: Implementar**

Crear `lib/dashboard/pivot-por-proveedor.ts`:

```ts
import { SIN_PROVEEDOR_KEY } from "./constants";
import type {
  SqlRow,
  ComposicionMes,
  PivotDataPorProveedor,
  PivotProveedorTopRow,
  PivotConceptoSubRow,
  PivotLineaRow,
} from "./types";

// Hermana de buildPivotData (app/api/dashboard/pivot/route.ts): misma fuente
// de filas (SqlRow[], una por línea de compra con rubro/concepto/proveedor ya
// resueltos), pero agrupa Proveedor → Concepto → línea en vez de
// Rubro → Concepto → línea. Ver spec §3.2.
export function buildPivotDataByProveedor(
  sqlRows: SqlRow[],
  composicionPorProveedor: Record<string, Record<number, ComposicionMes>>
): PivotDataPorProveedor {
  const proveedorMap = new Map<string, PivotProveedorTopRow>();
  const conceptoMap = new Map<string, PivotConceptoSubRow>();

  for (const row of sqlRows) {
    const {
      proveedor_id,
      proveedor_nombre,
      concepto_codigo,
      concepto_nombre,
      rubro_codigo,
      mes,
      total,
      row_id,
      distribucion_id,
      fecha,
      observac,
      has_manual_override,
    } = row;

    const t = typeof total === "object" && total !== null ? Number(total.toString()) : Number(total);

    const provKey = proveedor_id != null ? String(proveedor_id) : SIN_PROVEEDOR_KEY;
    const concKey = `${provKey}|${concepto_codigo}`;

    if (!proveedorMap.has(provKey)) {
      proveedorMap.set(provKey, {
        level: 0,
        id: provKey,
        nombre: proveedor_nombre,
        proveedorId: proveedor_id,
        values: {},
        rowTotal: 0,
        children: [],
      });
    }
    const proveedor = proveedorMap.get(provKey)!;

    if (!conceptoMap.has(concKey)) {
      const concepto: PivotConceptoSubRow = {
        level: 1,
        id: concKey,
        nombre: concepto_nombre,
        conceptoCodigo: concepto_codigo,
        rubroCodigo: rubro_codigo,
        values: {},
        rowTotal: 0,
        children: [],
        composicion: composicionPorProveedor[`${concepto_codigo}|${provKey}`],
      };
      conceptoMap.set(concKey, concepto);
      proveedor.children.push(concepto);
    }
    const concepto = conceptoMap.get(concKey)!;

    const linea: PivotLineaRow = {
      level: 2,
      id: `${concKey}|${row_id}|${distribucion_id ?? "orig"}`,
      rowId: row_id,
      distribucionId: distribucion_id,
      conceptoCodigo: concepto_codigo,
      fecha: fecha ?? null,
      observac: observac ?? null,
      importe: t,
      hasManualOverride: !!has_manual_override,
      values: { [mes]: t },
      rowTotal: t,
    };
    concepto.children.push(linea);
  }

  // Roll up bottom-up: línea → concepto → proveedor (mismo patrón que buildPivotData).
  for (const [, proveedor] of proveedorMap) {
    for (const concepto of proveedor.children) {
      for (const linea of concepto.children) {
        for (const [m, val] of Object.entries(linea.values)) {
          const mn = Number(m);
          concepto.values[mn] = (concepto.values[mn] ?? 0) + val;
        }
        concepto.rowTotal += linea.rowTotal;
      }
      for (const [m, val] of Object.entries(concepto.values)) {
        const mn = Number(m);
        proveedor.values[mn] = (proveedor.values[mn] ?? 0) + val;
      }
      proveedor.rowTotal += concepto.rowTotal;
    }
  }

  const columnTotals: Record<number, number> = {};
  let grandTotal = 0;
  for (const [, proveedor] of proveedorMap) {
    for (const [m, val] of Object.entries(proveedor.values)) {
      const mn = Number(m);
      columnTotals[mn] = (columnTotals[mn] ?? 0) + val;
    }
    grandTotal += proveedor.rowTotal;
  }

  return { rows: Array.from(proveedorMap.values()), columnTotals, grandTotal };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/pivot-por-proveedor.ts lib/dashboard/pivot-por-proveedor.test.ts
git commit -m "feat(dashboard): buildPivotDataByProveedor — árbol de compras agrupado por proveedor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Sort y flatten para el árbol por proveedor

**Files:**
- Modify: `lib/dashboard/pivot-utils.ts`
- Create: `lib/dashboard/pivot-utils.test.ts` (no existe todavía — solo se testean las funciones nuevas de este task, no se retrofittean tests para las funciones existentes, fuera de alcance)

**Interfaces:**
- Consumes: `PivotProveedorTopRow`, `PivotConceptoSubRow`, `PivotLineaRow`, `PivotDataPorProveedor` de `./types` (Task 1).
- Produces: `sortPivotRowsPorProveedor(rows: PivotProveedorTopRow[], col: SortCol, dir: SortDir): PivotProveedorTopRow[]`; `flattenRowsPorProveedor(pivotData: PivotDataPorProveedor, expanded: Set<string>): FlatRowPorProveedor[]`; tipo `FlatRowPorProveedor`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `lib/dashboard/pivot-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sortPivotRowsPorProveedor, flattenRowsPorProveedor } from "./pivot-utils";
import type { PivotProveedorTopRow, PivotConceptoSubRow, PivotLineaRow, PivotDataPorProveedor } from "./types";

function proveedorRow(overrides: Partial<PivotProveedorTopRow>): PivotProveedorTopRow {
  return {
    level: 0, id: "p1", nombre: "Proveedor A", proveedorId: 1,
    values: {}, rowTotal: 0, children: [],
    ...overrides,
  };
}

describe("sortPivotRowsPorProveedor", () => {
  it("ordena proveedores por total descendente", () => {
    const rows = [proveedorRow({ id: "p1", rowTotal: 100 }), proveedorRow({ id: "p2", rowTotal: 300 })];
    const sorted = sortPivotRowsPorProveedor(rows, "total", "desc");
    expect(sorted.map((r) => r.id)).toEqual(["p2", "p1"]);
  });

  it("no muta el array original", () => {
    const rows = [proveedorRow({ id: "p1", rowTotal: 100 }), proveedorRow({ id: "p2", rowTotal: 300 })];
    sortPivotRowsPorProveedor(rows, "total", "desc");
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
  });
});

describe("flattenRowsPorProveedor", () => {
  it("solo incluye el nivel proveedor cuando no hay nada expandido", () => {
    const data: PivotDataPorProveedor = { rows: [proveedorRow({ id: "p1" })], columnTotals: {}, grandTotal: 0 };
    const flat = flattenRowsPorProveedor(data, new Set());
    expect(flat).toEqual([{ type: "proveedorTop", data: data.rows[0] }]);
  });

  it("expande proveedor y concepto en cascada", () => {
    const linea: PivotLineaRow = {
      level: 2, id: "l1", rowId: "row-1", distribucionId: null, conceptoCodigo: "C1",
      fecha: null, observac: null, importe: 10, hasManualOverride: false, values: {}, rowTotal: 10,
    };
    const concepto: PivotConceptoSubRow = {
      level: 1, id: "p1|C1", nombre: "Concepto 1", conceptoCodigo: "C1", rubroCodigo: "R1",
      values: {}, rowTotal: 10, children: [linea],
    };
    const proveedor = proveedorRow({ id: "p1", children: [concepto] });
    const data: PivotDataPorProveedor = { rows: [proveedor], columnTotals: {}, grandTotal: 10 };

    const flat = flattenRowsPorProveedor(data, new Set(["p1", "p1|C1"]));
    expect(flat.map((f) => f.type)).toEqual(["proveedorTop", "conceptoSub", "linea"]);
  });

  it("no expande concepto si el proveedor padre no está expandido", () => {
    const concepto: PivotConceptoSubRow = {
      level: 1, id: "p1|C1", nombre: "Concepto 1", conceptoCodigo: "C1", rubroCodigo: "R1",
      values: {}, rowTotal: 10, children: [],
    };
    const proveedor = proveedorRow({ id: "p1", children: [concepto] });
    const data: PivotDataPorProveedor = { rows: [proveedor], columnTotals: {}, grandTotal: 10 };

    // "p1|C1" expandido pero "p1" no — no debería aparecer el nivel concepto.
    const flat = flattenRowsPorProveedor(data, new Set(["p1|C1"]));
    expect(flat).toEqual([{ type: "proveedorTop", data: proveedor }]);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/dashboard/pivot-utils.test.ts`
Expected: FAIL — `sortPivotRowsPorProveedor`/`flattenRowsPorProveedor` no existen.

- [ ] **Step 3: Implementar**

En `lib/dashboard/pivot-utils.ts`, agregar el import de los tipos nuevos junto al existente:

```ts
import type {
  DecimalLike, PivotData, PivotRubroRow, PivotConceptoRow, PivotProveedorRow,
  PivotDataPorProveedor, PivotProveedorTopRow, PivotConceptoSubRow, PivotLineaRow,
} from "./types";
```

Ampliar la firma de `getValue` (única función que necesita aceptar también los tipos nuevos — el resto de este archivo no cambia):

```ts
function getValue(
  row: PivotRubroRow | PivotConceptoRow | PivotProveedorRow | PivotProveedorTopRow | PivotConceptoSubRow | PivotLineaRow,
  col: SortCol
): number {
  return col === "total" ? row.rowTotal : (row.values[col as number] ?? 0);
}
```

Agregar al final del archivo:

```ts
/** Ordena el árbol "por proveedor" — misma lógica que sortPivotRows, sobre los tipos nuevos. */
export function sortPivotRowsPorProveedor(
  rows: PivotProveedorTopRow[],
  col: SortCol,
  dir: SortDir
): PivotProveedorTopRow[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...rows]
    .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
    .map((proveedor) => ({
      ...proveedor,
      children: [...proveedor.children]
        .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
        .map((concepto) => ({
          ...concepto,
          children: [...concepto.children].sort(
            (a, b) => factor * (getValue(a, col) - getValue(b, col))
          ),
        })),
    }));
}

export type FlatRowPorProveedor =
  | { type: "proveedorTop"; data: PivotProveedorTopRow }
  | { type: "conceptoSub"; data: PivotConceptoSubRow }
  | { type: "linea"; data: PivotLineaRow };

/** Aplana el árbol "por proveedor" respetando expansión — siempre 3 niveles (no hay variante maxDepth como en Ventas). */
export function flattenRowsPorProveedor(
  pivotData: PivotDataPorProveedor,
  expanded: Set<string>
): FlatRowPorProveedor[] {
  const result: FlatRowPorProveedor[] = [];
  for (const proveedor of pivotData.rows) {
    result.push({ type: "proveedorTop", data: proveedor });
    if (!expanded.has(proveedor.id)) continue;
    for (const concepto of proveedor.children) {
      result.push({ type: "conceptoSub", data: concepto });
      if (!expanded.has(concepto.id)) continue;
      for (const linea of concepto.children) {
        result.push({ type: "linea", data: linea });
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/dashboard/pivot-utils.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/pivot-utils.ts lib/dashboard/pivot-utils.test.ts
git commit -m "feat(dashboard): sort/flatten del árbol de compras por proveedor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Parámetro `agrupacion` en `params.ts`

**Files:**
- Modify: `lib/dashboard/params.ts`
- Test: `lib/dashboard/params.test.ts`

**Interfaces:**
- Produces: `AgrupacionCompras = "concepto" | "proveedor"` (exportado); `DashboardParams.agrupacion?: AgrupacionCompras`; `parseDashboardParams` lo parsea; `buildDashboardUrl` lo serializa.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/dashboard/params.test.ts`, agregar el import de `parseDashboardParams` y `buildDashboardUrl` junto al de `buildRangoAniosUrl`, y agregar al final del archivo:

```ts
describe("parseDashboardParams — agrupacion", () => {
  it("sin agrupacion en la URL: undefined (default concepto)", () => {
    const params = parseDashboardParams(new URLSearchParams());
    expect(params.agrupacion).toBeUndefined();
  });

  it("agrupacion=proveedor: se parsea", () => {
    const params = parseDashboardParams(new URLSearchParams("agrupacion=proveedor"));
    expect(params.agrupacion).toBe("proveedor");
  });

  it("valor inválido: undefined, no rompe", () => {
    const params = parseDashboardParams(new URLSearchParams("agrupacion=lo-que-sea"));
    expect(params.agrupacion).toBeUndefined();
  });
});

describe("buildDashboardUrl — agrupacion", () => {
  it("sin agrupacion: no agrega el parámetro (default concepto)", () => {
    const url = buildDashboardUrl("/api/dashboard/pivot", { year: 2026 });
    expect(url).not.toContain("agrupacion");
  });

  it("agrupacion proveedor: se agrega a la query", () => {
    const url = buildDashboardUrl("/api/dashboard/pivot", { year: 2026, agrupacion: "proveedor" });
    expect(url).toContain("agrupacion=proveedor");
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/dashboard/params.test.ts`
Expected: FAIL — `params.agrupacion` es siempre `undefined` incluso con `agrupacion=proveedor` en la URL, y el import de `parseDashboardParams`/`buildDashboardUrl` puede faltar (agregarlo si no está).

- [ ] **Step 3: Implementar**

En `lib/dashboard/params.ts`, agregar el tipo y el parser junto a `Vista`/`parseVista`:

```ts
export type AgrupacionCompras = "concepto" | "proveedor";

function parseAgrupacion(s: string | null): AgrupacionCompras | undefined {
  return s === "proveedor" ? "proveedor" : undefined;
}
```

Agregar el campo a la interfaz `DashboardParams`:

```ts
export interface DashboardParams {
  year: number;
  localId?: number;
  pdvId?: number;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
  months?: number[];
  vista?: Vista;
  agrupacion?: AgrupacionCompras;
}
```

En `parseDashboardParams`, agregar la línea al objeto devuelto:

```ts
    agrupacion: parseAgrupacion(sp.get("agrupacion")),
```

En `buildDashboardUrl`, agregar antes del `return`:

```ts
  if (params.agrupacion) sp.set("agrupacion", params.agrupacion);
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/dashboard/params.test.ts`
Expected: PASS (5 tests nuevos + 4 existentes).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/params.ts lib/dashboard/params.test.ts
git commit -m "feat(dashboard): parámetro agrupacion (concepto|proveedor) en params del pivot

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Wiring del endpoint `/api/dashboard/pivot`

**Files:**
- Modify: `app/api/dashboard/pivot/route.ts`

**Interfaces:**
- Consumes: `buildPivotDataByProveedor` (Task 3), `buildComposicionPorProveedor` (Task 2), `params.agrupacion: AgrupacionCompras | undefined` (Task 5).
- Produces: el endpoint devuelve `PivotData` (default, sin cambios) o `PivotDataPorProveedor` (cuando `?agrupacion=proveedor`).

No hay test automatizado nuevo para este task — no hay convención de tests de route handlers en este repo (los `buildPivotData*`/`buildComposicion*` que consume ya están testeados por unidad en los tasks 2 y 3). Se verifica con `curl` manual en el Step 4.

- [ ] **Step 1: Agregar `proveedor_id` a las dos queries de composición**

En `app/api/dashboard/pivot/route.ts`, en `composicionDestinosQuery` (dentro del `SELECT`), agregar la columna y el `GROUP BY`:

Reemplazar:

```sql
      da.porcentaje                                                AS pct,
      SUM(da."importeCalculado")                                   AS importe_calculado
    FROM v_compras_distribuidas c
    JOIN distribuciones_apertura da  ON da.id = c."distribucionId"
    JOIN destinos_regla dr           ON dr.id = da."destinoId"
    LEFT JOIN locales l              ON l.id = dr."localId"
    LEFT JOIN puntos_de_venta pv     ON pv.id = dr."puntoDeVentaId"
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE c."distribucionId" IS NOT NULL AND ${whereComposicion}
    GROUP BY concepto_codigo, mes, destino_nombre, da.porcentaje
```

por:

```sql
      p.id                                                          AS proveedor_id,
      da.porcentaje                                                AS pct,
      SUM(da."importeCalculado")                                   AS importe_calculado
    FROM v_compras_distribuidas c
    JOIN distribuciones_apertura da  ON da.id = c."distribucionId"
    JOIN destinos_regla dr           ON dr.id = da."destinoId"
    LEFT JOIN locales l              ON l.id = dr."localId"
    LEFT JOIN puntos_de_venta pv     ON pv.id = dr."puntoDeVentaId"
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE c."distribucionId" IS NOT NULL AND ${whereComposicion}
    GROUP BY concepto_codigo, proveedor_id, mes, destino_nombre, da.porcentaje
```

En `composicionOriginalesQuery`, reemplazar:

```sql
  const composicionOriginalesQuery = prisma.$queryRaw<ComposicionOriginalRow[]>(Prisma.sql`
    SELECT concepto_codigo, mes, SUM(importe_original) AS importe_original
    FROM (
      SELECT DISTINCT
        COALESCE(cc.codigo, '__sin_concepto')                       AS concepto_codigo,
        EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
        da."compraRowId",
        da."importeOriginal"                                        AS importe_original
      FROM v_compras_distribuidas c
      JOIN distribuciones_apertura da  ON da.id = c."distribucionId"
      LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
      LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
      WHERE c."distribucionId" IS NOT NULL AND ${whereComposicion}
    ) dedup
    GROUP BY concepto_codigo, mes
  `);
```

por:

```sql
  const composicionOriginalesQuery = prisma.$queryRaw<ComposicionOriginalRow[]>(Prisma.sql`
    SELECT concepto_codigo, proveedor_id, mes, SUM(importe_original) AS importe_original
    FROM (
      SELECT DISTINCT
        COALESCE(cc.codigo, '__sin_concepto')                       AS concepto_codigo,
        p.id                                                          AS proveedor_id,
        EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
        da."compraRowId",
        da."importeOriginal"                                        AS importe_original
      FROM v_compras_distribuidas c
      JOIN distribuciones_apertura da  ON da.id = c."distribucionId"
      LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
      LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
      WHERE c."distribucionId" IS NOT NULL AND ${whereComposicion}
    ) dedup
    GROUP BY concepto_codigo, proveedor_id, mes
  `);
```

- [ ] **Step 2: Agregar la rama por `agrupacion`**

Cambiar el import de `apertura-composicion`:

```ts
import {
  buildComposicion,
  buildComposicionPorProveedor,
  type ComposicionSqlRow,
  type ComposicionOriginalRow,
} from "@/lib/dashboard/apertura-composicion";
```

Agregar el import de la función nueva de árbol:

```ts
import { buildPivotDataByProveedor } from "@/lib/dashboard/pivot-por-proveedor";
```

Cambiar la desestructuración de `params` para incluir `agrupacion`:

```ts
  const { year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, months, vista, agrupacion } = params;
```

Reemplazar el final de la función (desde `const composicion = buildComposicion(...)` hasta el `return NextResponse.json(buildPivotData(rows, composicion));`) por:

```ts
  if (agrupacion === "proveedor") {
    const composicionPorProveedor = buildComposicionPorProveedor(composicionDestinos, composicionOriginales);
    return NextResponse.json(buildPivotDataByProveedor(rows, composicionPorProveedor));
  }

  const composicion = buildComposicion(composicionDestinos, composicionOriginales);
  return NextResponse.json(buildPivotData(rows, composicion));
```

- [ ] **Step 3: Correr la suite completa y el build**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS / sin errores (este task no agrega tests propios, pero no debe romper ninguno de los existentes ni el chequeo de tipos).

- [ ] **Step 4: Verificación manual contra la base real**

Con el server corriendo (`npm run dev`), autenticado en el dashboard:

```bash
curl -s "http://localhost:3000/api/dashboard/pivot?year=2026&agrupacion=proveedor" -H "Cookie: <cookie de sesión del browser>" | head -c 2000
```

Expected: JSON con forma `{ rows: [{ level: 0, proveedorId, nombre, children: [{ level: 1, conceptoCodigo, children: [{ level: 2, rowId, ... }] }] }], columnTotals, grandTotal }`. Repetir sin `agrupacion` y confirmar que la forma vuelve a ser la de siempre (`rubroCodigo` en el nivel 0).

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard/pivot/route.ts
git commit -m "feat(dashboard): endpoint de pivot soporta agrupacion=proveedor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Estado de agrupación en el store + threading en `useOperacionKpis`

**Files:**
- Modify: `hooks/use-dashboard-store.ts`
- Modify: `hooks/use-operacion-kpis.ts`

**Interfaces:**
- Consumes: `AgrupacionCompras` de `@/lib/dashboard/params` (Task 5); `PivotData`, `PivotDataPorProveedor` de `@/lib/dashboard/types` (Task 1).
- Produces: `useDashboard().agrupacionCompras: AgrupacionCompras`, `useDashboard().setAgrupacionCompras: (a: AgrupacionCompras) => void`; `useOperacionKpis<T extends PivotData | PivotDataPorProveedor = PivotData>(params): { data: T | undefined; isLoading; error; ventasData; ventasLoading }`.

- [ ] **Step 1: Agregar el estado al store**

En `hooks/use-dashboard-store.ts`, agregar el import:

```ts
import type { AgrupacionCompras } from "@/lib/dashboard/params";
```

Agregar a la interfaz `DashboardStore`, junto al bloque `// navigation`:

```ts
  agrupacionCompras: AgrupacionCompras;
  setAgrupacionCompras: (a: AgrupacionCompras) => void;
```

Agregar a la implementación, junto a `setTab`:

```ts
      agrupacionCompras: "concepto" as AgrupacionCompras,
      setAgrupacionCompras: (a) => set({ agrupacionCompras: a }),
```

Agregar `agrupacionCompras` al `partialize` (para que persista igual que `tab`/`year`):

```ts
      partialize: (s) => ({
        stored: s.stored,
        sortCol: s.sortCol,
        sortDir: s.sortDir,
        year: s.year,
        tab: s.tab,
        localId: s.localId,
        pdvId: s.pdvId,
        agrupacionCompras: s.agrupacionCompras,
      }),
```

Exponer desde `useDashboard()` (en el `return`, junto a `setTab`):

```ts
    agrupacionCompras: s.agrupacionCompras, setAgrupacionCompras: s.setAgrupacionCompras,
```

- [ ] **Step 2: Genericizar `useOperacionKpis`**

En `hooks/use-operacion-kpis.ts`, agregar el import de `AgrupacionCompras` y `PivotDataPorProveedor`:

```ts
import { buildDashboardUrl, buildVentasPivotUrl, type Vista, type AgrupacionCompras } from "@/lib/dashboard/params";
import type { PivotData, PivotDataPorProveedor } from "@/lib/dashboard/types";
```

Agregar `agrupacion` a la interfaz de parámetros:

```ts
interface UseOperacionKpisParams {
  year: number;
  localId?: number;
  pdvId?: number;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
  months: number[];
  activeMonths?: number[];
  configVersion: number;
  vista?: Vista;
  agrupacion?: AgrupacionCompras;
}
```

Genericizar la función (default `PivotData` para no romper a los llamadores existentes, que no pasan tipo explícito):

```ts
export function useOperacionKpis<T extends PivotData | PivotDataPorProveedor = PivotData>({
  year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
  months, activeMonths, configVersion, vista, agrupacion,
}: UseOperacionKpisParams) {
  const url = useMemo(() => {
    const base = buildDashboardUrl("/api/dashboard/pivot", {
      year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, months: activeMonths, vista, agrupacion,
    });
    return configVersion > 0 ? `${base}&_rcv=${configVersion}` : base;
  }, [year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, activeMonths, configVersion, vista, agrupacion]);

  const { data, isLoading, error } = useFetchQuery<T>(
    ["pivot", vista ?? "compras", agrupacion ?? "concepto", year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, months, configVersion],
    url
  );

  const ventasUrl = useMemo(
    () => buildVentasPivotUrl("/api/dashboard/pivot-ventas", { year, localId, pdvId, months: activeMonths }),
    [year, localId, pdvId, activeMonths]
  );

  const { data: ventasData, isLoading: ventasLoading } = useFetchQuery<PivotData>(
    ["pivot-ventas", year, localId, pdvId, months],
    ventasUrl
  );

  return { data, isLoading, error, ventasData, ventasLoading };
}
```

- [ ] **Step 3: Verificar que compila y no rompe consumidores existentes**

Run: `npx tsc --noEmit`
Expected: sin errores — `PivotTable` (Compras) y `useResultadosData` (Resultados) siguen llamando `useOperacionKpis({...})` sin tipo explícito, y por el default `T = PivotData` siguen recibiendo `data: PivotData | undefined` como antes.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-dashboard-store.ts hooks/use-operacion-kpis.ts
git commit -m "feat(dashboard): estado de agrupación de Compras + useOperacionKpis genérico

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Hook `usePivotScreenDataPorProveedor`

**Files:**
- Create: `hooks/use-pivot-screen-data-por-proveedor.ts`

**Interfaces:**
- Consumes: `flattenRowsPorProveedor`, `sortPivotRowsPorProveedor`, `SortCol`, `SortDir` de `@/lib/dashboard/pivot-utils` (Task 4); `PivotDataPorProveedor`, `DetalleFilter`, `VentasDetalleFilter` de `@/lib/dashboard/types`; `useExpandableSet` de `@/hooks/use-expandable-set` (ya existe).
- Produces: `usePivotScreenDataPorProveedor(params): { expanded, toggleRow, collapseAll, collapseConceptos, flatRows, detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle }` — misma forma de retorno que `usePivotScreenData`, para que `PivotTableByProveedor` (Task 10) pueda consumirlo igual que `PivotTableByConcepto` consume el original.

No hay test unitario nuevo para este hook — es orquestación de estado de React (mismo criterio que el `usePivotScreenData` existente, que tampoco tiene test propio); su comportamiento se verifica junto con el componente en el Task 11.

- [ ] **Step 1: Implementar**

Crear `hooks/use-pivot-screen-data-por-proveedor.ts`:

```ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExpandableSet } from "@/hooks/use-expandable-set";
import { flattenRowsPorProveedor, sortPivotRowsPorProveedor, type SortCol, type SortDir } from "@/lib/dashboard/pivot-utils";
import type { PivotDataPorProveedor, DetalleFilter, VentasDetalleFilter } from "@/lib/dashboard/types";

interface UsePivotScreenDataPorProveedorParams {
  data: PivotDataPorProveedor | undefined;
  year: number;
  localId?: number;
  pdvId?: number;
  sortCol: SortCol;
  sortDir: SortDir;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
}

// Hermano de usePivotScreenData (lib/dashboard/pivot-utils.ts), para el árbol
// Proveedor → Concepto → línea en vez de Rubro → Concepto → línea. Misma
// forma de retorno a propósito, para que PivotTableByProveedor consuma este
// hook igual que PivotTableByConcepto consume el original.
export function usePivotScreenDataPorProveedor({
  data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
}: UsePivotScreenDataPorProveedorParams) {
  const { expanded, setExpanded, toggle: toggleRow, collapseAll } = useExpandableSet();
  const [detalleFilter, setDetalleFilter] = useState<DetalleFilter | null>(null);
  const [ventasDetalleFilter, setVentasDetalleFilter] = useState<VentasDetalleFilter | null>(null);
  const prevFilterRef = useRef<{ conceptoCodigo?: string; proveedorId?: number; observacionQuery?: string }>({});

  useEffect(() => {
    if (!data) return;
    const prev = prevFilterRef.current;
    const filterChanged =
      prev.conceptoCodigo !== conceptoCodigo || prev.proveedorId !== proveedorId || prev.observacionQuery !== observacionQuery;
    prevFilterRef.current = { conceptoCodigo, proveedorId, observacionQuery };
    if (!filterChanged) return;

    if (conceptoCodigo || proveedorId || observacionQuery) {
      const ids = new Set<string>();
      for (const proveedor of data.rows) {
        ids.add(proveedor.id);
        for (const concepto of proveedor.children) ids.add(concepto.id);
      }
      setExpanded(ids);
    } else {
      setExpanded(new Set());
    }
  }, [data, conceptoCodigo, proveedorId, observacionQuery, setExpanded]);

  function openDetalle(extra: Omit<DetalleFilter, "year" | "localId" | "pdvId">) {
    setDetalleFilter({ year, localId, pdvId, ...extra });
  }

  const sortedRows = useMemo(
    () => (data ? sortPivotRowsPorProveedor(data.rows, sortCol, sortDir) : []),
    [data, sortCol, sortDir]
  );

  const flatRows = useMemo(
    () => flattenRowsPorProveedor({ rows: sortedRows, columnTotals: data?.columnTotals ?? {}, grandTotal: data?.grandTotal ?? 0 }, expanded),
    [sortedRows, expanded, data]
  );

  const proveedorIds = useMemo(() => new Set(sortedRows.map((r) => r.id)), [sortedRows]);

  const collapseConceptos = useCallback((e: React.MouseEvent) => {
    if (navigator.maxTouchPoints > 0) return;
    e.preventDefault();
    setExpanded((prev) => new Set([...prev].filter((id) => proveedorIds.has(id))));
  }, [proveedorIds, setExpanded]);

  return {
    expanded, toggleRow, collapseAll, collapseConceptos,
    sortedRows, flatRows, isEmpty: flatRows.length === 0,
    detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  };
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-pivot-screen-data-por-proveedor.ts
git commit -m "feat(dashboard): hook de expand/collapse/detalle para el árbol por proveedor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Toggle de agrupación en los filtros

**Files:**
- Modify: `components/dashboard/dashboard-filters.tsx`

**Interfaces:**
- Consumes: `useDashboard().agrupacionCompras`, `useDashboard().setAgrupacionCompras` (Task 7).

- [ ] **Step 1: Agregar el toggle**

En `components/dashboard/dashboard-filters.tsx`, agregar `agrupacionCompras` y `setAgrupacionCompras` a la desestructuración de `useDashboard()`:

```ts
  const {
    tab, year, localId, pdvId,
    setYear, setLocalId, setPdvId,
    selectedMonths, toggleMonth, clearMonths,
    activeSearchParam: activeParam, searchLabel,
    clearSearch,
    agrupacionCompras, setAgrupacionCompras,
  } = useDashboard();
```

Agregar el import de `ListTree`/`Users` (ícono) junto a los demás de `lucide-react` — se usa `Users` para "por proveedor":

```ts
import { CalendarDays, Building2, Store, Search, X, Filter, ChevronLeft, ChevronRight, Users } from "lucide-react";
```

Agregar el toggle en la fila de controles desktop, justo antes del bloque `{!isVentas && (<div className="flex items-center gap-2 ml-auto shrink-0">`, condicionado a `tab === "compras"` (no aplica a Ventas ni a Resultados — Resultados no tiene noción de proveedor en su vista):

```tsx
        {tab === "compras" && (
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5">
            <button
              onClick={() => setAgrupacionCompras("concepto")}
              aria-pressed={agrupacionCompras === "concepto"}
              className={cn(
                "h-7 px-2.5 rounded-md text-xs font-medium transition-all",
                agrupacionCompras === "concepto"
                  ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Concepto
            </button>
            <button
              onClick={() => setAgrupacionCompras("proveedor")}
              aria-pressed={agrupacionCompras === "proveedor"}
              className={cn(
                "h-7 px-2.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1",
                agrupacionCompras === "proveedor"
                  ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Users className="w-3 h-3" />
              Proveedor
            </button>
          </div>
        )}
```

- [ ] **Step 2: Verificar que compila y lint pasa**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/dashboard-filters.tsx
git commit -m "feat(dashboard): toggle Ver por Concepto/Proveedor en los filtros de Compras

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Extraer `PivotTableByConcepto` (mover, sin cambios de lógica)

**Files:**
- Create: `components/dashboard/pivot-table-por-concepto.tsx` (contenido actual de `pivot-table.tsx`)
- Modify: `components/dashboard/pivot-table.tsx` (se reescribe en el Task 12, después de que exista `PivotTableByProveedor`)

**Interfaces:**
- Produces: `PivotTableByConcepto` (componente, mismo comportamiento que el `PivotTable` actual).

- [ ] **Step 1: Copiar el contenido actual a `pivot-table-por-concepto.tsx`**

Crear `components/dashboard/pivot-table-por-concepto.tsx` con el contenido íntegro y sin cambios de `components/dashboard/pivot-table.tsx` (375 líneas), renombrando únicamente el nombre exportado:

- Cambiar `export function PivotTable() {` por `export function PivotTableByConcepto() {`.
- El resto del archivo (imports, JSX, lógica) queda idéntico byte a byte.

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos (en este momento `pivot-table.tsx` sigue existiendo tal cual y sigue siendo el que se importa desde el resto de la app — no se rompe nada todavía; el switcher se arma en el Task 12).

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/pivot-table-por-concepto.tsx
git commit -m "refactor(dashboard): extrae PivotTableByConcepto sin cambios de lógica

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Componente `PivotTableByProveedor`

**Files:**
- Create: `components/dashboard/pivot-table-por-proveedor.tsx`

**Interfaces:**
- Consumes: `useOperacionKpis<PivotDataPorProveedor>` (Task 7), `usePivotScreenDataPorProveedor` (Task 8), `PivotProveedorTopRow`/`PivotConceptoSubRow`/`PivotDataPorProveedor` (Task 1), `ComprasDetalleModal`, `VentasDetalleModal`, `AperturaGastosModal`, `KpiBlock`, `PivotLoading`/`PivotError`/`PivotEmpty`, `EditedDot`, `useReglasApertura`, `origenAlcanza` (todos ya existentes, sin cambios).
- Produces: `PivotTableByProveedor` (componente).

**Nota de alcance (decidida en el diseño, spec §6 / plan):** en la fila "Sin Proveedor" (`proveedorId === null`), los clicks de drill-down a detalle quedan deshabilitados — `/api/dashboard/detalle` no tiene forma de filtrar por "proveedor es null" (a diferencia de rubro/concepto, que usan un código sentinel de texto contra una columna ya coalescida; proveedor es un FK numérico nullable sin ese truco disponible). Mostrar el total sin permitir un drill-down que traería *todas* las compras sin filtrar sería peor que no ofrecerlo.

- [ ] **Step 1: Implementar el componente**

Crear `components/dashboard/pivot-table-por-proveedor.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { usePivotScreenDataPorProveedor } from "@/hooks/use-pivot-screen-data-por-proveedor";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { ChevronDown, ChevronUp, Split } from "lucide-react";
import { cn, fmtARS } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { hasValue } from "@/lib/dashboard/pivot-utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { origenAlcanza } from "@/lib/apertura/validaciones";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import { KpiBlock } from "./kpi-block";
import { EditedDot } from "./edit-row-controls";
import type { PivotDataPorProveedor, PivotProveedorTopRow, PivotConceptoSubRow } from "@/lib/dashboard/types";
import { ComprasDetalleModal } from "./compras-detalle-modal";
import { VentasDetalleModal } from "./ventas-detalle-modal";
import { AperturaGastosModal } from "./apertura-gastos-modal";

export function PivotTableByProveedor() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion,
  } = useDashboard();

  const [pctMode, setPctMode] = useState<"ingresos" | "egresos">("ingresos");
  const [aperturaConcepto, setAperturaConcepto] = useState<{ codigo: string; nombre: string } | null>(null);
  const { reglas } = useReglasApertura();
  const conceptosConReglaActiva = useMemo(() => {
    const activas = reglas.filter((r) => r.estado === "activa");
    const alcanzaFiltro = (r: (typeof activas)[number]) => {
      if (pdvId == null && localId == null) return true;
      if (pdvId != null) {
        return origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          { localId: localId ?? r.origenLocalId, puntoDeVentaId: pdvId }
        );
      }
      return r.origenLocalId === localId;
    };
    return new Set(activas.filter(alcanzaFiltro).map((r) => r.entidadId));
  }, [reglas, localId, pdvId]);

  const { data, isLoading, error, ventasData, ventasLoading } = useOperacionKpis<PivotDataPorProveedor>({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, configVersion: rubroConfigVersion, agrupacion: "proveedor",
  });

  const {
    expanded, toggleRow, collapseAll, collapseConceptos,
    flatRows, detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  } = usePivotScreenDataPorProveedor({
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
  });

  if (isLoading) return <PivotLoading />;
  if (error) return <PivotError />;
  if (!data || data.rows.length === 0) return <PivotEmpty />;

  const pctDenominator = pctMode === "ingresos" ? (ventasData?.grandTotal ?? 0) : data.grandTotal;

  function fmtPct(rowTotal: number): string {
    if (pctMode === "ingresos" && ventasLoading) return "…";
    return pctDenominator > 0 ? `${((rowTotal / pctDenominator) * 100).toFixed(1)}%` : "—";
  }

  const ingresosPorMes = ventasData?.columnTotals ?? {};
  const egresosPorMes = data.columnTotals;

  return (
    <>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <KpiBlock
              months={months}
              ingresosPorMes={ingresosPorMes}
              egresosPorMes={egresosPorMes}
              ingresosTotal={ventasData?.grandTotal}
              egresosTotal={data.grandTotal}
              ingresosReady={!!ventasData}
              variant="borderless"
              onIngresoCellClick={(mes) => setVentasDetalleFilter({ year, localId, pdvId, mes })}
              onIngresoTotalClick={() => setVentasDetalleFilter({ year, localId, pdvId })}
            />
            <tr className="bg-muted border-b">
              <th className="sticky left-0 top-0 z-30 bg-muted text-left px-4 py-3 font-medium text-muted-foreground min-w-[240px] whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                Proveedor / Concepto
              </th>
              {months.map((idx) => (
                <th key={idx} className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium min-w-[90px] whitespace-nowrap">
                  <button
                    onClick={() => handleSortClick(idx)}
                    className={cn(
                      "inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors",
                      sortCol === idx ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {MONTHS[idx - 1]}
                    {sortCol === idx ? (
                      sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                    ) : (
                      sortDir === "desc" ? <ChevronDown className="w-3 h-3 opacity-40" /> : <ChevronUp className="w-3 h-3 opacity-40" />
                    )}
                  </button>
                </th>
              ))}
              <th className="sticky top-0 z-20 bg-muted text-right px-4 py-3 font-semibold text-[15px] min-w-[110px] whitespace-nowrap">
                <button
                  onClick={() => handleSortClick("total")}
                  className={cn(
                    "inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors",
                    sortCol === "total" ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  Total
                  {sortCol === "total" ? (
                    sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                  ) : (
                    sortDir === "desc" ? <ChevronDown className="w-3 h-3 opacity-40" /> : <ChevronUp className="w-3 h-3 opacity-40" />
                  )}
                </button>
              </th>
              <th
                className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium text-muted-foreground min-w-[64px] whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => setPctMode((m) => m === "ingresos" ? "egresos" : "ingresos")}
                title={pctMode === "ingresos" ? "% sobre ingresos — click para cambiar a % sobre egresos" : "% sobre egresos — click para cambiar a % sobre ingresos"}
              >
                % {pctMode === "ingresos" ? "ing" : "egr"}
              </th>
            </tr>
          </thead>

          <tbody>
            {flatRows.map((item) => {
              if (item.type === "proveedorTop") {
                const proveedor = item.data as PivotProveedorTopRow;
                const isExpanded = expanded.has(proveedor.id);
                // "Sin Proveedor" no se puede filtrar en /api/dashboard/detalle
                // (no hay forma de pedir "proveedorId IS NULL" ahí) — no ofrecer
                // un drill-down que traería todas las compras sin filtrar.
                const puedeDrillDown = proveedor.proveedorId != null;
                return (
                  <tr key={proveedor.id} className="border-b font-semibold" onContextMenu={collapseAll}>
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <ExpandableButton isExpanded={isExpanded} onClick={() => toggleRow(proveedor.id)}>
                        {proveedor.nombre}
                      </ExpandableButton>
                    </td>
                    {months.map((mes) => (
                      <td
                        key={mes}
                        className={cn(
                          "text-right px-3 py-2.5 tabular-nums bg-muted/25 hover:bg-muted/50 transition-colors",
                          puedeDrillDown && hasValue(proveedor.values[mes]) && "cursor-pointer hover:text-primary"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (puedeDrillDown && hasValue(proveedor.values[mes]))
                            openDetalle({ mes, proveedorId: proveedor.proveedorId! });
                        }}
                      >
                        {fmtARS(proveedor.values[mes])}
                      </td>
                    ))}
                    <td
                      className={cn(
                        "text-right px-4 py-2.5 tabular-nums font-semibold text-[15px] bg-muted/25 hover:bg-muted/50 transition-colors",
                        puedeDrillDown && "cursor-pointer hover:text-primary"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (puedeDrillDown) openDetalle({ proveedorId: proveedor.proveedorId! });
                      }}
                    >
                      {fmtARS(proveedor.rowTotal)}
                    </td>
                    <td className="text-right px-3 py-2.5 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap bg-muted/25 hover:bg-muted/50 transition-colors">
                      {fmtPct(proveedor.rowTotal)}
                    </td>
                  </tr>
                );
              }

              if (item.type === "conceptoSub") {
                const concepto = item.data as PivotConceptoSubRow;
                const isExpanded = expanded.has(concepto.id);
                return (
                  <tr key={concepto.id} className="border-b hover:bg-accent/40 transition-colors" onContextMenu={collapseConceptos}>
                    <td className="sticky left-0 z-10 bg-background px-4 py-2 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <div className="flex items-center gap-1">
                        <ExpandableButton
                          isExpanded={isExpanded}
                          onClick={() => toggleRow(concepto.id)}
                          indent="pl-5"
                          iconSize="w-3.5 h-3.5"
                          className="flex-1 min-w-0"
                        >
                          {concepto.nombre}
                        </ExpandableButton>
                        {localId != null && (
                          <button
                            type="button"
                            title="Apertura de gastos"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAperturaConcepto({ codigo: concepto.conceptoCodigo, nombre: concepto.nombre });
                            }}
                            className={cn(
                              "shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors",
                              conceptosConReglaActiva.has(concepto.conceptoCodigo)
                                ? "text-primary"
                                : "text-muted-foreground/40 hover:text-muted-foreground"
                            )}
                          >
                            <Split className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    {months.map((mes) => {
                      const comp = concepto.composicion?.[mes];
                      const cell = (
                        <td
                          key={mes}
                          className={cn(
                            "text-right px-3 py-2 tabular-nums text-muted-foreground",
                            hasValue(concepto.values[mes]) && "cursor-pointer hover:text-foreground"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasValue(concepto.values[mes]))
                              openDetalle({ mes, conceptoCodigo: concepto.conceptoCodigo });
                          }}
                        >
                          {fmtARS(concepto.values[mes])}
                        </td>
                      );
                      if (!comp) return cell;
                      return (
                        <Tooltip key={mes}>
                          <TooltipTrigger asChild>{cell}</TooltipTrigger>
                          <TooltipContent className="text-xs">
                            <div className="font-medium">100% · {fmtARS(comp.total)}</div>
                            {comp.destinos.map((d, i) => (
                              <div key={i} className="text-background/70">
                                {d.pct}% {d.nombre} {fmtARS(d.importe)}
                              </div>
                            ))}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                    <td
                      className="text-right px-4 py-2 tabular-nums text-muted-foreground font-semibold text-sm cursor-pointer hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetalle({ conceptoCodigo: concepto.conceptoCodigo });
                      }}
                    >
                      {fmtARS(concepto.rowTotal)}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums text-xs text-muted-foreground/50 whitespace-nowrap">
                      {fmtPct(concepto.rowTotal)}
                    </td>
                  </tr>
                );
              }

              const linea = item.data;
              const labelParts = [
                linea.fecha ? `${linea.fecha.slice(8, 10)}/${linea.fecha.slice(5, 7)}` : null,
                linea.observac || null,
                fmtARS(linea.importe),
              ].filter(Boolean);
              return (
                <tr
                  key={linea.id}
                  className={cn(
                    "border-b transition-colors",
                    linea.hasManualOverride ? "bg-attention/5 hover:bg-attention/10" : "hover:bg-accent/20"
                  )}
                >
                  <td className={cn("sticky left-0 z-10 bg-background px-4 py-1.5 pl-14 text-xs shadow-[1px_0_0_0_hsl(var(--border))]", linea.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5">
                      {linea.hasManualOverride && <EditedDot />}
                      {labelParts.join(' · ')}
                    </span>
                  </td>
                  {months.map((mes) => (
                    <td
                      key={mes}
                      className={cn(
                        "text-right px-3 py-1.5 tabular-nums text-muted-foreground text-xs",
                        hasValue(linea.values[mes]) && "cursor-pointer hover:text-foreground"
                      )}
                      onClick={() => {
                        if (hasValue(linea.values[mes]))
                          openDetalle({ rowId: linea.rowId, distribucionId: linea.distribucionId ?? undefined });
                      }}
                    >
                      {fmtARS(linea.values[mes])}
                    </td>
                  ))}
                  <td
                    className="text-right px-4 py-1.5 tabular-nums text-muted-foreground text-xs cursor-pointer hover:text-foreground"
                    onClick={() => openDetalle({ rowId: linea.rowId, distribucionId: linea.distribucionId ?? undefined })}
                  >
                    {fmtARS(linea.rowTotal)}
                  </td>
                  <td className="text-right px-3 py-1.5 tabular-nums text-xs text-muted-foreground/40 whitespace-nowrap">
                    {fmtPct(linea.rowTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t-2 bg-muted font-semibold text-[15px]">
              <td className="sticky left-0 z-10 bg-muted px-4 py-3 shadow-[1px_0_0_0_hsl(var(--border))]">
                Total {year}
              </td>
              {months.map((mes) => (
                <td key={mes} className="text-right px-3 py-3 tabular-nums bg-muted">
                  {fmtARS(data.columnTotals[mes])}
                </td>
              ))}
              <td className="text-right px-4 py-3 tabular-nums text-primary bg-muted">
                {fmtARS(data.grandTotal)}
              </td>
              <td className="text-right px-3 py-3 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap font-semibold bg-muted">
                {pctMode === "egresos" ? "—" : fmtPct(data.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ComprasDetalleModal filter={detalleFilter} onClose={() => setDetalleFilter(null)} />
      <VentasDetalleModal filter={ventasDetalleFilter} onClose={() => setVentasDetalleFilter(null)} />

      <AperturaGastosModal
        conceptoCodigo={aperturaConcepto?.codigo ?? null}
        conceptoNombre={aperturaConcepto?.nombre ?? ""}
        origenLocalId={localId ?? null}
        origenPdvId={pdvId ?? null}
        onClose={() => setAperturaConcepto(null)}
      />
    </>
  );
}
```

- [ ] **Step 2: Verificar que compila y lint pasa**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/pivot-table-por-proveedor.tsx
git commit -m "feat(dashboard): componente PivotTableByProveedor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Switcher `PivotTable`

**Files:**
- Modify: `components/dashboard/pivot-table.tsx` (se reescribe por completo — su contenido anterior ya vive en `pivot-table-por-concepto.tsx` desde el Task 10)

**Interfaces:**
- Consumes: `PivotTableByConcepto` (Task 10), `PivotTableByProveedor` (Task 11), `useDashboard().agrupacionCompras` (Task 7).
- Produces: `PivotTable` (mismo nombre y mismo import path que usan sus consumidores actuales — no hace falta tocar quién lo importa).

- [ ] **Step 1: Reescribir `pivot-table.tsx` como switcher**

Reemplazar el contenido completo de `components/dashboard/pivot-table.tsx` por:

```tsx
"use client";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { PivotTableByConcepto } from "./pivot-table-por-concepto";
import { PivotTableByProveedor } from "./pivot-table-por-proveedor";

export function PivotTable() {
  const { agrupacionCompras } = useDashboard();
  return agrupacionCompras === "proveedor" ? <PivotTableByProveedor /> : <PivotTableByConcepto />;
}
```

- [ ] **Step 2: Verificar que compila, lint pasa y el build completo funciona**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sin errores en ninguno de los tres.

- [ ] **Step 3: Correr toda la suite de tests**

Run: `npm run test`
Expected: PASS — todos los tests existentes más los agregados en los tasks 2, 3, 4 y 5.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/pivot-table.tsx
git commit -m "refactor(dashboard): PivotTable pasa a ser un switcher por agrupacionCompras

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Verificación manual contra datos reales

No hay test de browser disponible en este entorno (limitación ya aceptada en el proyecto — ver historial de Fase C de Apertura de Gastos en memoria). Este task es una checklist manual antes de cerrar la tarea, corrida por el usuario o por quien tenga acceso al dashboard corriendo:

- [ ] **Step 1: Levantar el dashboard** — `npm run dev`, ir a Compras.
- [ ] **Step 2: Confirmar que la vista por defecto (Concepto) se ve exactamente igual que antes** — mismos totales, mismo comportamiento de expand/collapse, drill-down y apertura.
- [ ] **Step 3: Cambiar el toggle a "Proveedor"** — confirmar que aparece el árbol Proveedor → Concepto → línea, que los totales por mes y el gran total coinciden con los de la vista por Concepto (es la misma plata, solo reorganizada).
- [ ] **Step 4: Verificar el tooltip de composición** en un concepto aperturado dentro de un proveedor específico — el total del tooltip debe coincidir con el importe de esa fila (no con el total del concepto cruzando todos los proveedores).
- [ ] **Step 5: Verificar "Sin Proveedor"** — la fila existe, muestra su total, pero sus celdas no son clickeables (sin drill-down), consistente con la nota de alcance del Task 11.
- [ ] **Step 6: Cambiar de local/PDV y de filtros de búsqueda (rubro/concepto/proveedor/observación) con la vista en "Proveedor" activa** — confirmar que los filtros globales siguen aplicando igual que en la vista por Concepto.
- [ ] **Step 7: Recargar la página** — confirmar que el toggle persiste en "Proveedor" (estado persistido en el store).
- [ ] **Step 8: Avisar al usuario con el resultado de esta checklist** antes de dar la tarea por cerrada — si algo no coincide, no improvisar un fix fuera de este plan: reportarlo y decidir el siguiente paso junto al usuario.

---

## Self-Review

**1. Cobertura del spec:** §1-2 (alcance) → Tasks 1-12 en conjunto. §3.1 (tipos) → Task 1. §3.2 (construcción del árbol) → Tasks 3, 6. §3.3 (composición por proveedor) → Task 2, 6. §4 (UI) → Tasks 9, 10, 11, 12. §5 (testing) → Tasks 2, 3, 4 (unitarios) + Task 13 (manual, límite ya aceptado). §6 (riesgos — colisión de id, generalizar recién a la 3ª repetición) → resuelto en el diseño de `id` del Task 3 y documentado en el comentario de Task 1.

**2. Placeholders:** revisado — no quedan "TBD"/"agregar validación"/"similar al Task N" sin código. El único punto explícitamente dejado fuera (reglas nivel-proveedor) está en el spec como fuera de alcance, no como placeholder de este plan.

**3. Consistencia de tipos:** `PivotLineaRow`/`PivotConceptoSubRow`/`PivotProveedorTopRow`/`PivotDataPorProveedor` (Task 1) se usan con los mismos nombres de campo en `pivot-por-proveedor.ts` (Task 3), `pivot-utils.ts` (Task 4), `use-pivot-screen-data-por-proveedor.ts` (Task 8) y `pivot-table-por-proveedor.tsx` (Task 11) — verificado campo por campo. `buildComposicionPorProveedor` (Task 2) devuelve la clave `` `${concepto}|${proveedorId}` `` y `buildPivotDataByProveedor` (Task 3) la consume con el mismo formato. `AgrupacionCompras` (Task 5) es el mismo tipo importado en `use-dashboard-store.ts` y `use-operacion-kpis.ts` (Task 7).
