# Agrupar "Sin Proveedor" por texto crudo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En la vista "Compras x Proveedor", agrupar por el texto crudo del ERP (Diego, Gabriel, "GASTOS VARIOS", etc.) en vez de un balde único "Sin Proveedor" cuando no hay un proveedor real vinculado — en el árbol, en el tooltip de composición de Apertura, y en el drill-down al detalle.

**Architecture:** Se extrae la normalización de texto (NFD + sin puntuación) a un módulo neutral compartido por ETL y dashboard. `pivot-por-proveedor.ts` y `apertura-composicion.ts` pasan de usar una clave sentinela fija a usar `texto:<normalizado>` cuando no hay `proveedorId`. El drill-down suma un tercer modo de filtro (`proveedorTexto`) junto a los dos que ya existían (`proveedorId` / `sinProveedor`).

**Tech Stack:** TypeScript, Prisma 7 (`$queryRaw` + `Prisma.sql`), Zod, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-09-19-agrupar-sin-proveedor-por-texto-crudo-design.md`

## Global Constraints

- TDD obligatorio para toda la lógica de `lib/` (helpers puros, comparación/agrupación de texto) — test que falla antes que código. No aplica a la Task 6 (componente React): este proyecto no tiene tests de componentes (verificado — no existe ningún `*.test.tsx` en `components/`), se verifica con `tsc`/lint + revisión manual, mismo criterio que el resto del código de UI existente.
- Nada de `any` sin justificar; modo estricto de TypeScript.
- Ningún `catch {}` vacío.
- No agregar dependencias nuevas.
- Todo dato externo (query params de una API route) se valida con Zod `safeParse` en el servidor (CLAUDE.md §5) — no parsear a mano.
- `npm run lint` y `npx tsc --noEmit` limpios antes de dar cualquier task por cerrada.

---

## Task 1: Extraer la normalización de texto a un módulo neutral

**Files:**
- Create: `lib/text-normalize.ts`
- Test: `lib/text-normalize.test.ts`

**Interfaces:**
- Produces: `export function normalizarTexto(s: string): string`. Usado por Task 2 (`lib/etl/normalizers/proveedor-match.ts`), Task 3 (`lib/dashboard/pivot-por-proveedor.ts`) y Task 4 (`lib/dashboard/apertura-composicion.ts`).

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// lib/text-normalize.test.ts
import { describe, it, expect } from "vitest";
import { normalizarTexto } from "./text-normalize";

describe("normalizarTexto", () => {
  it("minúsculas y sin cambios en alfanumérico simple", () => {
    expect(normalizarTexto("Diego")).toBe("diego");
  });

  it("tildes se transliteran, no se descartan (Agustín == Agustin)", () => {
    expect(normalizarTexto("Agustín")).toBe(normalizarTexto("Agustin"));
    expect(normalizarTexto("Agustín")).toBe("agustin");
  });

  it("eñe se transllitera a n", () => {
    expect(normalizarTexto("Muñoz")).toBe("munoz");
  });

  it("puntuación y espacios se descartan", () => {
    expect(normalizarTexto("Compra Ocasional / ML")).toBe(normalizarTexto("Compra Ocasional  ML"));
    expect(normalizarTexto("Compra Ocasional / ML")).toBe("compraocasionalml");
  });

  it("dos textos sin relación no coinciden", () => {
    expect(normalizarTexto("Diego")).not.toBe(normalizarTexto("Creacion Tm Sr"));
  });
});
```

- [ ] **Step 2: Correr los tests, verificar que fallan**

Run: `npx vitest run lib/text-normalize.test.ts`
Expected: FAIL — `Cannot find module './text-normalize'`

- [ ] **Step 3: Implementación**

```ts
// lib/text-normalize.ts

// Normaliza texto para comparaciones tolerantes a mayúsculas, tildes y
// puntuación — NFD + strip de marcas combinantes antes de descartar lo
// no-alfanumérico (si no, "Agustín" perdería la "í" entera y dejaría de
// coincidir con "Agustin"). Usado tanto por el ETL (lib/etl/normalizers/
// proveedor-match.ts, para no confiar en un código de proveedor que coincide
// por azar con un código real) como por el dashboard (lib/dashboard/
// pivot-por-proveedor.ts, lib/dashboard/apertura-composicion.ts, para agrupar
// compras sin proveedor real por su texto crudo del ERP) — un solo criterio
// de comparación en ambas capas.
export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
```

- [ ] **Step 4: Correr los tests, verificar que pasan**

Run: `npx vitest run lib/text-normalize.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/text-normalize.ts lib/text-normalize.test.ts
git commit -m "feat: extrae normalizarTexto a un módulo compartido por ETL y dashboard"
```

---

## Task 2: `proveedor-match.ts` usa el módulo compartido

**Files:**
- Modify: `lib/etl/normalizers/proveedor-match.ts:1-19`

**Interfaces:**
- Consumes: `normalizarTexto(s: string): string` de Task 1 (`../../text-normalize`).

- [ ] **Step 1: Confirmar el comportamiento actual con los tests existentes**

Run: `npx vitest run lib/etl/normalizers/proveedor-match.test.ts`
Expected: PASS (11 tests) — este es el baseline antes de tocar el archivo; estos tests no cambian en esta task, solo deben seguir pasando después del Step 2.

- [ ] **Step 2: Reemplazar la función privada por el import compartido**

En `lib/etl/normalizers/proveedor-match.ts`, agregar el import y borrar la función `normalizarParaComparar` local:

```ts
import { normalizarTexto } from "../../text-normalize";
```

Reemplazar el bloque:

```ts
function normalizarParaComparar(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
```

por (borrarlo — nada lo reemplaza en este archivo, se usa el import). Reemplazar las dos llamadas a `normalizarParaComparar(...)` dentro de `proveedorTextoCoincide` por `normalizarTexto(...)`:

```ts
export function proveedorTextoCoincide(
  textoCrudo: string | null,
  candidato: { nombre: string | null; razon: string | null }
): boolean {
  if (textoCrudo == null) return true;
  const t = normalizarTexto(textoCrudo);
  return (
    (candidato.nombre != null && normalizarTexto(candidato.nombre) === t) ||
    (candidato.razon != null && normalizarTexto(candidato.razon) === t)
  );
}
```

(El resto del archivo — `ProveedorCandidato`, `resolveProveedorId` — no cambia.)

- [ ] **Step 3: Correr los tests, verificar que siguen pasando**

Run: `npx vitest run lib/etl/normalizers/proveedor-match.test.ts`
Expected: PASS (11 tests) — mismo resultado que el Step 1, ahora usando el módulo compartido.

- [ ] **Step 4: Typecheck y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/proveedor-match.ts
git commit -m "refactor(etl): proveedor-match usa normalizarTexto compartido en vez de su copia privada"
```

---

## Task 3: Árbol de la vista por proveedor agrupa por texto crudo

**Files:**
- Modify: `lib/dashboard/types.ts` (agregar campo a `PivotProveedorSubRow` y `PivotConceptoSubRow`)
- Modify: `lib/dashboard/pivot-por-proveedor.ts:1,50,67-79,82-97`
- Test: `lib/dashboard/pivot-por-proveedor.test.ts`

**Interfaces:**
- Consumes: `normalizarTexto(s: string): string` de Task 1 (`./text-normalize` — ruta relativa desde `lib/dashboard/`, es decir `../text-normalize`).
- Produces: `PivotProveedorSubRow.proveedorTexto: string | null` y `PivotConceptoSubRow.proveedorTexto: string | null` — usados por Task 6 (`components/dashboard/pivot-table-por-proveedor.tsx`) para armar el filtro de drill-down.

- [ ] **Step 1: Escribir/reemplazar los tests que fallan**

En `lib/dashboard/pivot-por-proveedor.test.ts`, reemplazar el test existente "proveedor null usa la clave __sin_proveedor y muestra el label sentinela sin importar el texto crudo del ERP" (líneas 74-85) — ese comportamiento es exactamente el que este fix revierte — y agregar los casos nuevos:

```ts
// Reemplaza el test "proveedor null usa la clave __sin_proveedor..." existente.
// Quitar también el import de SIN_PROVEEDOR_NOMBRE si este era su único uso en el archivo.

it("proveedor_id null: usa el texto crudo del ERP como nombre del grupo, no un label sentinela", () => {
  const rows: SqlRow[] = [
    row({ proveedor_id: null, proveedor_nombre: "Diego", row_id: "x1", total: 10 }),
  ];
  const data = buildPivotDataByProveedor(rows, {});
  const proveedor = data.rows[0].children[0];
  expect(proveedor.proveedorId).toBeNull();
  expect(proveedor.nombre).toBe("Diego");
  expect(proveedor.proveedorTexto).toBe("Diego");
});

it("dos textos crudos distintos sin proveedor real: dos nodos separados, no se mezclan", () => {
  const rows: SqlRow[] = [
    row({ proveedor_id: null, proveedor_nombre: "Diego", row_id: "x1", total: 10 }),
    row({ proveedor_id: null, proveedor_nombre: "GASTOS VARIOS", row_id: "x2", total: 20 }),
  ];
  const data = buildPivotDataByProveedor(rows, {});
  const rubro = data.rows[0];
  expect(rubro.children).toHaveLength(2);
  const diego = rubro.children.find((p) => p.nombre === "Diego")!;
  const gastosVarios = rubro.children.find((p) => p.nombre === "GASTOS VARIOS")!;
  expect(diego.rowTotal).toBe(10);
  expect(gastosVarios.rowTotal).toBe(20);
});

it("mismo texto crudo con mayúsculas/tildes distintas: mismo nodo (agrupa normalizado)", () => {
  const rows: SqlRow[] = [
    row({ proveedor_id: null, proveedor_nombre: "Agustín", row_id: "x1", total: 10 }),
    row({ proveedor_id: null, proveedor_nombre: "AGUSTIN", row_id: "x2", total: 15 }),
  ];
  const data = buildPivotDataByProveedor(rows, {});
  const rubro = data.rows[0];
  expect(rubro.children).toHaveLength(1);
  expect(rubro.children[0].rowTotal).toBe(25);
  // El label mostrado es el texto de la PRIMERA fila vista de ese grupo, no una forma normalizada.
  expect(rubro.children[0].nombre).toBe("Agustín");
});

it("sin proveedor ni texto crudo (el literal 'Sin Proveedor' de la SQL): cae en su propio grupo, separado de cualquier texto real", () => {
  const rows: SqlRow[] = [
    row({ proveedor_id: null, proveedor_nombre: "Sin Proveedor", row_id: "x1", total: 5 }),
    row({ proveedor_id: null, proveedor_nombre: "Diego", row_id: "x2", total: 10 }),
  ];
  const data = buildPivotDataByProveedor(rows, {});
  const rubro = data.rows[0];
  expect(rubro.children).toHaveLength(2);
  const sinDatos = rubro.children.find((p) => p.nombre === "Sin Proveedor")!;
  const diego = rubro.children.find((p) => p.nombre === "Diego")!;
  expect(sinDatos.rowTotal).toBe(5);
  expect(diego.rowTotal).toBe(10);
});

it("proveedor real (proveedor_id no null): proveedorTexto queda null", () => {
  const rows: SqlRow[] = [row({ proveedor_id: 1, proveedor_nombre: "Proveedor A", row_id: "a1" })];
  const data = buildPivotDataByProveedor(rows, {});
  expect(data.rows[0].children[0].proveedorTexto).toBeNull();
});
```

- [ ] **Step 2: Correr los tests, verificar que fallan**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: FAIL — `proveedorTexto` no existe en el tipo todavía, y el nodo sigue mostrando "Sin Proveedor" en vez del texto crudo.

- [ ] **Step 3: Agregar el campo a los tipos**

En `lib/dashboard/types.ts`, agregar `proveedorTexto: string | null` a `PivotConceptoSubRow` (línea ~93, junto a `proveedorId`) y a `PivotProveedorSubRow` (línea ~104, junto a `proveedorId`):

```ts
export type PivotConceptoSubRow = {
  readonly level: 2;
  readonly id: string;
  readonly nombre: string;
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;
  readonly proveedorId: number | null;
  readonly proveedorTexto: string | null;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotLineaRow[];
  composicion?: Record<number, ComposicionMes>;
};

export type PivotProveedorSubRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;
  readonly proveedorId: number | null;
  readonly proveedorTexto: string | null;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoSubRow[];
};
```

- [ ] **Step 4: Implementación en `pivot-por-proveedor.ts`**

Cambiar el import (línea 1): quitar `SIN_PROVEEDOR_KEY, SIN_PROVEEDOR_NOMBRE` de `./constants` y agregar el import de la normalización:

```ts
import { normalizarTexto } from "../text-normalize";
```

Reemplazar la construcción de `provKeyOriginal` (línea 50):

```ts
    // provKeyOriginal identifica al proveedor a secas (usado para la clave de
    // composición, que no sabe de rubros); provKey lo compone con el rubro
    // para que el mismo proveedor genere un nodo distinto por cada rubro en
    // el que tiene compras (mismo criterio de duplicación que ya usa
    // buildPivotData con sus proveedores-hoja).
    //
    // Sin proveedor_id, proveedor_nombre ya trae el texto crudo del ERP (o el
    // literal "Sin Proveedor" si tampoco hay texto — ver COALESCE en
    // app/api/dashboard/pivot/route.ts) — se usa normalizado como clave para
    // no fragmentar el mismo proveedor por un typo de mayúsculas/tildes en
    // una carga futura (spec 2026-09-19-agrupar-sin-proveedor-por-texto-crudo-design.md §3.2).
    const provKeyOriginal = proveedor_id != null
      ? String(proveedor_id)
      : `texto:${normalizarTexto(proveedor_nombre)}`;
    const provKey = `${rubro_codigo}|${provKeyOriginal}`;
    const concKey = `${provKey}|${concepto_codigo}`;
```

Reemplazar la construcción del nodo proveedor (líneas 67-79):

```ts
    if (!proveedorMap.has(provKey)) {
      const proveedor: PivotProveedorSubRow = {
        level: 1,
        id: provKey,
        nombre: proveedor_nombre,
        proveedorId: proveedor_id,
        proveedorTexto: proveedor_id != null ? null : proveedor_nombre,
        values: {},
        rowTotal: 0,
        children: [],
      };
      proveedorMap.set(provKey, proveedor);
      rubro.children.push(proveedor);
    }
    const proveedor = proveedorMap.get(provKey)!;
```

Agregar `proveedorTexto` a la construcción del nodo concepto (líneas 82-97, agregar el campo junto a `proveedorId: proveedor_id,`):

```ts
    if (!conceptoMap.has(concKey)) {
      const concepto: PivotConceptoSubRow = {
        level: 2,
        id: concKey,
        nombre: concepto_nombre,
        conceptoCodigo: concepto_codigo,
        rubroCodigo: rubro_codigo,
        proveedorId: proveedor_id,
        proveedorTexto: proveedor_id != null ? null : proveedor_nombre,
        values: {},
        rowTotal: 0,
        children: [],
        composicion: composicionPorProveedor[`${concepto_codigo}|${provKeyOriginal}`],
      };
      conceptoMap.set(concKey, concepto);
      proveedor.children.push(concepto);
    }
    const concepto = conceptoMap.get(concKey)!;
```

- [ ] **Step 5: Correr los tests, verificar que pasan**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: PASS (10 tests: los 5 preexistentes que no se tocan — "agrupa por rubro...", "un proveedor con compras en dos rubros...", "rollup mensual...", "adjunta la composición...", "dos líneas de la misma compra..." — más los 5 del Step 1, que reemplazan al único test viejo sobre el comportamiento de "proveedor null")

- [ ] **Step 6: Typecheck y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores (si algún otro archivo usaba `PivotProveedorSubRow`/`PivotConceptoSubRow` sin el campo nuevo, TypeScript lo va a marcar — construirlo en todos los sitios donde se arma el objeto, que en este código es únicamente `pivot-por-proveedor.ts`)

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/types.ts lib/dashboard/pivot-por-proveedor.ts lib/dashboard/pivot-por-proveedor.test.ts
git commit -m "feat(dashboard): agrupa 'Sin Proveedor' por el texto crudo del ERP en la vista por proveedor"
```

---

## Task 4: Composición del tooltip usa el mismo criterio

**Files:**
- Modify: `lib/dashboard/apertura-composicion.ts` (todo el archivo — tipos, `key`, `ensure`, los dos loops de `buildComposicionPorProveedor`)
- Modify: `app/api/dashboard/pivot/route.ts:106-157` (las dos queries de composición)
- Modify: `lib/dashboard/constants.ts:26-34` (borrar `SIN_PROVEEDOR_KEY`/`SIN_PROVEEDOR_NOMBRE`, ya sin consumidores tras esta task)
- Test: `lib/dashboard/apertura-composicion.test.ts`

**Interfaces:**
- Consumes: `normalizarTexto(s: string): string` de Task 1 (`./text-normalize` → `../text-normalize` desde `lib/dashboard/`).
- Produces: la clave de `buildComposicionPorProveedor` para el caso sin proveedor pasa a tener el formato `${concepto}|texto:${normalizado}` — Task 3 ya arma `provKeyOriginal` con ese mismo formato exacto (`texto:${normalizarTexto(proveedor_nombre)}`), así que el lookup `composicionPorProveedor[`${concepto_codigo}|${provKeyOriginal}`]` en `pivot-por-proveedor.ts` sigue funcionando sin cambios.

- [ ] **Step 1: Escribir/actualizar los tests que fallan**

En `lib/dashboard/apertura-composicion.test.ts`, TODAS las filas de `destinoRows`/`originalRows` en TODOS los tests (tanto los de `buildComposicion` como los de `buildComposicionPorProveedor`, porque comparten los mismos tipos `ComposicionSqlRow`/`ComposicionOriginalRow`) necesitan el campo nuevo `proveedor_nombre`. Reescribir el archivo completo:

```ts
// lib/dashboard/apertura-composicion.test.ts
import { describe, it, expect } from "vitest";
import { buildComposicion, buildComposicionPorProveedor } from "./apertura-composicion";

describe("buildComposicion", () => {
  it("agrupa por concepto+mes y arma la lista de destinos con pct e importe", () => {
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 73993 },
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Canchas Ramos", pct: 10, importe_calculado: 10570 },
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Canchas SJ", pct: 10, importe_calculado: 10570 },
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Descartado", pct: 10, importe_calculado: 10571 },
    ];
    const originalRows = [{ concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, importe_original: 105704 }];
    const result = buildComposicion(destinoRows, originalRows);
    expect(result["17"][5].total).toBe(105704);
    expect(result["17"][5].destinos).toHaveLength(4);
    expect(result["17"][5].destinos[0]).toEqual({ nombre: "Actual", pct: 70, importe: 73993 });
  });

  it("convierte Decimal-like (string) a number", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "3", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 1, destino_nombre: "X", pct: "50.00", importe_calculado: "1000.00" }],
      [{ concepto_codigo: "3", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 1, importe_original: "2000.00" }]
    );
    expect(result["3"][1].destinos[0]).toEqual({ nombre: "X", pct: 50, importe: 1000 });
    expect(result["3"][1].total).toBe(2000);
  });

  it("concepto+mes sin fila de original: total 0 (no rompe)", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "9", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 2, destino_nombre: "X", pct: 100, importe_calculado: 5 }],
      []
    );
    expect(result["9"][2].total).toBe(0);
  });

  it("fusiona destinos con mismo nombre+pct cuando la SQL llega particionada por proveedor, sumando el importe", () => {
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 40000 },
      { concepto_codigo: "17", proveedor_id: 2, proveedor_nombre: "Proveedor B", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 33993 },
    ];
    const originalRows = [{ concepto_codigo: "17", proveedor_id: null, proveedor_nombre: "Sin Proveedor", mes: 5, importe_original: 105704 }];
    const result = buildComposicion(destinoRows, originalRows);
    expect(result["17"][5].destinos).toHaveLength(1);
    expect(result["17"][5].destinos[0]).toEqual({ nombre: "Actual", pct: 70, importe: 73993 });
  });
});

describe("buildComposicionPorProveedor", () => {
  it("agrupa por concepto+proveedor+mes, sin mezclar proveedores", () => {
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 700 },
      { concepto_codigo: "17", proveedor_id: 2, proveedor_nombre: "Proveedor B", mes: 5, destino_nombre: "Actual", pct: 50, importe_calculado: 500 },
    ];
    const originalRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, importe_original: 1000 },
      { concepto_codigo: "17", proveedor_id: 2, proveedor_nombre: "Proveedor B", mes: 5, importe_original: 1000 },
    ];
    const result = buildComposicionPorProveedor(destinoRows, originalRows);

    expect(result["17|1"][5].total).toBe(1000);
    expect(result["17|1"][5].destinos).toEqual([{ nombre: "Actual", pct: 70, importe: 700 }]);
    expect(result["17|2"][5].destinos).toEqual([{ nombre: "Actual", pct: 50, importe: 500 }]);
  });

  it("proveedor_id null: usa el texto crudo normalizado como clave, no un sentinela fijo", () => {
    const result = buildComposicionPorProveedor(
      [{ concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", mes: 1, destino_nombre: "X", pct: 100, importe_calculado: 500 }],
      [{ concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", mes: 1, importe_original: 500 }]
    );
    expect(result["3|texto:diego"][1].total).toBe(500);
  });

  it("dos textos crudos distintos sin proveedor real, mismo concepto: NO se mezclan en la misma composición", () => {
    const destinoRows = [
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", mes: 1, destino_nombre: "Local A", pct: 100, importe_calculado: 100 },
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "GASTOS VARIOS", mes: 1, destino_nombre: "Local B", pct: 100, importe_calculado: 200 },
    ];
    const originalRows = [
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", mes: 1, importe_original: 100 },
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "GASTOS VARIOS", mes: 1, importe_original: 200 },
    ];
    const result = buildComposicionPorProveedor(destinoRows, originalRows);
    expect(result["3|texto:diego"][1].destinos).toEqual([{ nombre: "Local A", pct: 100, importe: 100 }]);
    expect(result["3|texto:gastosvarios"][1].destinos).toEqual([{ nombre: "Local B", pct: 100, importe: 200 }]);
  });

  it("no afecta a buildComposicion existente (sigue agrupando solo por concepto)", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 700 }],
      [{ concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, importe_original: 1000 }]
    );
    expect(result["17"][5].total).toBe(1000);
  });

  it("NO fusiona dos destinos distintos del mismo bucket (concepto+proveedor+mes) aunque compartan pct", () => {
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 700 },
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Canchas Ramos", pct: 70, importe_calculado: 300 },
    ];
    const originalRows = [{ concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, importe_original: 1000 }];
    const result = buildComposicionPorProveedor(destinoRows, originalRows);

    expect(result["17|1"][5].destinos).toHaveLength(2);
    expect(result["17|1"][5].destinos).toEqual([
      { nombre: "Actual", pct: 70, importe: 700 },
      { nombre: "Canchas Ramos", pct: 70, importe: 300 },
    ]);
  });
});
```

- [ ] **Step 2: Correr los tests, verificar que fallan**

Run: `npx vitest run lib/dashboard/apertura-composicion.test.ts`
Expected: FAIL — el tipo `ComposicionSqlRow`/`ComposicionOriginalRow` no tiene `proveedor_nombre` todavía (error de tipo) y la clave sigue siendo `__sin_proveedor`, no `texto:diego`.

- [ ] **Step 3: Implementación**

Reescribir `lib/dashboard/apertura-composicion.ts` completo:

```ts
import type { ComposicionMes } from "./types";
import { normalizarTexto } from "../text-normalize";

type DecimalLike = number | string | { toString(): string };
const toNum = (x: DecimalLike): number =>
  typeof x === "object" && x !== null ? Number(x.toString()) : Number(x);

export type ComposicionSqlRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
  destino_nombre: string;
  pct: DecimalLike;
  importe_calculado: DecimalLike;
};

export type ComposicionOriginalRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
  importe_original: DecimalLike;
};

// Arma el mapa concepto -> mes -> { total (= 100%), destinos[] } que consume el
// tooltip de pivot-table. `total` viene de importe_original YA deduplicado por
// compra en SQL (ver app/api/dashboard/pivot/route.ts) — acá solo se suman las
// filas ya agregadas.
export function buildComposicion(
  destinoRows: ComposicionSqlRow[],
  originalRows: ComposicionOriginalRow[]
): Record<string, Record<number, ComposicionMes>> {
  const out: Record<string, Record<number, ComposicionMes>> = {};

  const ensure = (concepto: string, mes: number): ComposicionMes => {
    out[concepto] ??= {};
    out[concepto][mes] ??= { total: 0, destinos: [] };
    return out[concepto][mes];
  };

  for (const row of originalRows) {
    ensure(row.concepto_codigo, row.mes).total += toNum(row.importe_original);
  }
  for (const row of destinoRows) {
    const bucket = ensure(row.concepto_codigo, row.mes);
    const pct = toNum(row.pct);
    const importe = toNum(row.importe_calculado);
    // La SQL ahora particiona estas filas también por proveedor_id (para poder
    // alimentar buildComposicionPorProveedor) — acá se vuelven a fusionar por
    // (nombre, pct) para reproducir exactamente el agrupamiento que la propia
    // query hacía antes de esa partición (GROUP BY ..., destino_nombre, da.porcentaje).
    const existente = bucket.destinos.find((d) => d.nombre === row.destino_nombre && d.pct === pct);
    if (existente) {
      existente.importe += importe;
    } else {
      bucket.destinos.push({ nombre: row.destino_nombre, pct, importe });
    }
  }
  return out;
}

// Misma idea que buildComposicion, pero indexada también por proveedor: el
// tooltip de la vista "por Proveedor" necesita el reparto de ESE proveedor en
// ESE concepto, no el total cruzando todos los proveedores del concepto (que
// es lo que devuelve buildComposicion) — ver spec §3.3.
//
// Sin proveedor_id, la clave usa el texto crudo normalizado (mismo formato
// `texto:<normalizado>` que arma provKeyOriginal en pivot-por-proveedor.ts,
// para que el lookup por esa clave encuentre esta entrada) en vez de un
// sentinela fijo — así "Diego" y "GASTOS VARIOS" no comparten composición
// aunque ninguno tenga proveedor real (spec 2026-09-19-agrupar-sin-proveedor-por-texto-crudo-design.md §3.3).
export function buildComposicionPorProveedor(
  destinoRows: ComposicionSqlRow[],
  originalRows: ComposicionOriginalRow[]
): Record<string, Record<number, ComposicionMes>> {
  const out: Record<string, Record<number, ComposicionMes>> = {};

  const key = (concepto: string, proveedorId: number | null, proveedorNombre: string) =>
    `${concepto}|${proveedorId != null ? String(proveedorId) : `texto:${normalizarTexto(proveedorNombre)}`}`;

  const ensure = (concepto: string, proveedorId: number | null, proveedorNombre: string, mes: number): ComposicionMes => {
    const k = key(concepto, proveedorId, proveedorNombre);
    out[k] ??= {};
    out[k][mes] ??= { total: 0, destinos: [] };
    return out[k][mes];
  };

  for (const row of originalRows) {
    ensure(row.concepto_codigo, row.proveedor_id, row.proveedor_nombre, row.mes).total += toNum(row.importe_original);
  }
  // A diferencia de buildComposicion, acá no hace falta fusionar: la clave del
  // bucket ya incluye proveedor_id (o el texto crudo normalizado), que junto
  // con (destino_nombre, porcentaje) coincide exactamente con el GROUP BY de
  // la SQL (concepto_codigo, proveedor_id, proveedor_nombre, mes,
  // destino_nombre, da.porcentaje) — dos filas del mismo bucket nunca pueden
  // compartir (nombre, pct). Si ese GROUP BY cambia, revisar este supuesto.
  for (const row of destinoRows) {
    ensure(row.concepto_codigo, row.proveedor_id, row.proveedor_nombre, row.mes).destinos.push({
      nombre: row.destino_nombre,
      pct: toNum(row.pct),
      importe: toNum(row.importe_calculado),
    });
  }
  return out;
}
```

En `app/api/dashboard/pivot/route.ts`, en `composicionDestinosQuery` (bloque que empieza en la línea ~113), agregar la columna al `SELECT` justo después de `p.id AS proveedor_id,`:

```sql
      p.id                                                          AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')   AS proveedor_nombre,
```

y agregar `proveedor_nombre` al `GROUP BY` de esa query:

```sql
    GROUP BY concepto_codigo, proveedor_id, proveedor_nombre, mes, destino_nombre, da.porcentaje
```

En `composicionOriginalesQuery` (bloque que empieza en la línea ~143), agregar la misma columna al `SELECT DISTINCT` interno (después de `p.id AS proveedor_id,`):

```sql
        p.id                                                          AS proveedor_id,
        COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')   AS proveedor_nombre,
```

y agregarla también al `SELECT`/`GROUP BY` externos:

```sql
    SELECT concepto_codigo, proveedor_id, proveedor_nombre, mes, SUM(importe_original) AS importe_original
    FROM (
      ...
    ) dedup
    GROUP BY concepto_codigo, proveedor_id, proveedor_nombre, mes
```

En `lib/dashboard/constants.ts`, borrar (ya sin ningún consumidor tras esta task — verificado con `grep -rn "SIN_PROVEEDOR" --include="*.ts" --include="*.tsx" .`):

```ts
// Clave sintética para agrupar compras sin proveedor asignado en el árbol
// "por proveedor" — análoga a SIN_RUBRO_CODE/SIN_CONCEPTO_CODE de arriba,
// pero el id de proveedor es numérico (FK nullable), no un código de texto,
// así que no hay valor numérico "mágico" que reusar como con rubro/concepto.
export const SIN_PROVEEDOR_KEY = "__sin_proveedor";

// Label a mostrar para el bucket "sin proveedor" del árbol por proveedor —
// distinto de SIN_PROVEEDOR_KEY (clave de agrupación): la SQL de
// /api/dashboard/pivot cae a c.proveedor (texto crudo del ERP de un proveedor
// SIN vincular) antes de llegar al literal 'Sin Proveedor' cuando proveedor_id
// es null, así que no se puede confiar en proveedor_nombre para este caso.
export const SIN_PROVEEDOR_NOMBRE = "Sin Proveedor";
```

- [ ] **Step 4: Correr los tests, verificar que pasan**

Run: `npx vitest run lib/dashboard/apertura-composicion.test.ts lib/dashboard/pivot-por-proveedor.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Typecheck y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/apertura-composicion.ts lib/dashboard/apertura-composicion.test.ts app/api/dashboard/pivot/route.ts lib/dashboard/constants.ts
git commit -m "fix(dashboard): composición del tooltip de Apertura no mezcla textos crudos distintos sin proveedor"
```

---

## Task 5: Filtro de drill-down por texto crudo

**Files:**
- Modify: `lib/dashboard/types.ts` (agregar `proveedorTexto` a `DetalleFilter`)
- Modify: `lib/dashboard/schemas.ts` (agregar `textoLibreSchema`)
- Modify: `lib/dashboard/params.ts:96-107` (`buildComprasDetalleUrl`)
- Modify: `app/api/dashboard/detalle/route.ts:195-213`
- Test: `lib/dashboard/params.test.ts`

**Interfaces:**
- Produces: `DetalleFilter.proveedorTexto?: string` — usado por Task 6 (`components/dashboard/pivot-table-por-proveedor.tsx`).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `lib/dashboard/params.test.ts`, dentro de (o junto a) `describe("buildComprasDetalleUrl — sinProveedor", ...)`:

```ts
describe("buildComprasDetalleUrl — proveedorTexto", () => {
  it("con proveedorTexto: agrega proveedorTexto, no proveedorId ni sinProveedor", () => {
    const url = buildComprasDetalleUrl({ year: 2026, proveedorTexto: "Diego" });
    expect(url).toContain("proveedorTexto=Diego");
    expect(url).not.toContain("proveedorId=");
    expect(url).not.toContain("sinProveedor");
  });

  it("proveedorId tiene prioridad sobre proveedorTexto si ambos vinieran seteados", () => {
    const url = buildComprasDetalleUrl({ year: 2026, proveedorId: 5, proveedorTexto: "Diego" });
    expect(url).toContain("proveedorId=5");
    expect(url).not.toContain("proveedorTexto");
  });
});
```

- [ ] **Step 2: Correr los tests, verificar que fallan**

Run: `npx vitest run lib/dashboard/params.test.ts`
Expected: FAIL — `buildComprasDetalleUrl` no reconoce `proveedorTexto` todavía (error de tipo en el test, y la URL generada no contiene el parámetro)

- [ ] **Step 3: Implementación**

En `lib/dashboard/types.ts`, `DetalleFilter` (líneas ~135-145):

```ts
export type DetalleFilter = BaseDashboardFilter & {
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  // Sin proveedorId pero con texto crudo del ERP (Diego, Gabriel, GASTOS
  // VARIOS, etc.) — mutuamente excluyente con proveedorId y sinProveedor.
  proveedorTexto?: string;
  // Sin proveedorId NI texto crudo — las compras realmente sin ningún dato de
  // proveedor. Mutuamente excluyente con proveedorId y proveedorTexto.
  sinProveedor?: boolean;
  rowId?: string;
  distribucionId?: number;
};
```

En `lib/dashboard/schemas.ts`, agregar:

```ts
export const textoLibreSchema = z.string().max(256);
```

En `lib/dashboard/params.ts`, `buildComprasDetalleUrl` (líneas 96-107):

```ts
export function buildComprasDetalleUrl(filter: DetalleFilter): string {
  const params = new URLSearchParams({ year: String(filter.year) });
  if (filter.localId) params.set("localId", String(filter.localId));
  if (filter.pdvId) params.set("pdvId", String(filter.pdvId));
  if (filter.mes) params.set("mes", String(filter.mes));
  if (filter.rubroCodigo) params.set("rubroCodigo", filter.rubroCodigo);
  if (filter.conceptoCodigo) params.set("conceptoCodigo", filter.conceptoCodigo);
  if (filter.proveedorId) params.set("proveedorId", String(filter.proveedorId));
  else if (filter.proveedorTexto) params.set("proveedorTexto", filter.proveedorTexto);
  else if (filter.sinProveedor) params.set("sinProveedor", "1");
  if (filter.rowId) params.set("rowId", filter.rowId);
  if (filter.distribucionId != null) params.set("distribucionId", String(filter.distribucionId));
  return `/api/dashboard/detalle?${params}`;
}
```

En `app/api/dashboard/detalle/route.ts`, importar `textoLibreSchema` junto a los otros schemas (línea 5):

```ts
import { mesSchema, yearSchema, idSchema, codigoSchema, textoLibreSchema } from "@/lib/dashboard/schemas";
```

Agregar el parseo (junto a `sinProveedor`, línea ~196):

```ts
  const proveedorId = idSchema.safeParse(searchParams.get("proveedorId")).data;
  const proveedorTextoRaw = searchParams.get("proveedorTexto");
  const proveedorTexto = proveedorTextoRaw ? textoLibreSchema.safeParse(proveedorTextoRaw).data : undefined;
  const sinProveedor = searchParams.get("sinProveedor") === "1";
```

Reemplazar la condición existente (línea ~212-213):

```ts
  if (proveedorId !== undefined) conditions.push(Prisma.sql`p.id = ${proveedorId}`);
  else if (proveedorTexto !== undefined) conditions.push(Prisma.sql`c."proveedorId" IS NULL AND c.proveedor = ${proveedorTexto}`);
  else if (sinProveedor) conditions.push(Prisma.sql`c."proveedorId" IS NULL AND c.proveedor IS NULL`);
```

(Antes, la rama `sinProveedor` solo filtraba `c."proveedorId" IS NULL` — ahora que `proveedorTexto` cubre las compras con texto, `sinProveedor` se acota a las que además no tienen texto, para no solaparse con los nodos de texto crudo.)

- [ ] **Step 4: Correr los tests, verificar que pasan**

Run: `npx vitest run lib/dashboard/params.test.ts`
Expected: PASS (todos, incluidos los 2 nuevos)

- [ ] **Step 5: Typecheck y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/types.ts lib/dashboard/schemas.ts lib/dashboard/params.ts lib/dashboard/params.test.ts app/api/dashboard/detalle/route.ts
git commit -m "feat(dashboard): filtro de detalle por texto crudo de proveedor (drill-down)"
```

---

## Task 6: UI — drill-down usa el filtro por texto crudo

**Files:**
- Modify: `components/dashboard/pivot-table-por-proveedor.tsx:227-229,286-289`

**Interfaces:**
- Consumes: `PivotProveedorSubRow.proveedorTexto`/`PivotConceptoSubRow.proveedorTexto` de Task 3, `DetalleFilter.proveedorTexto` de Task 5.

No hay test automatizado para este componente (no existe ningún `*.test.tsx` en `components/` en este proyecto) — se verifica con `tsc`/lint y con una pasada manual en el navegador (ver Step 3).

- [ ] **Step 1: Implementación**

En `components/dashboard/pivot-table-por-proveedor.tsx`, reemplazar la construcción de `filtroProveedor` (dentro del branch `item.type === "proveedorSub"`, líneas ~227-229):

```ts
                const filtroProveedor = proveedor.proveedorId != null
                  ? { proveedorId: proveedor.proveedorId }
                  : proveedor.proveedorTexto != null
                    ? { proveedorTexto: proveedor.proveedorTexto }
                    : { sinProveedor: true as const };
```

y la construcción de `filtroProveedorConcepto` (dentro del branch `item.type === "conceptoSub"`, líneas ~286-289):

```ts
                const filtroProveedorConcepto = concepto.proveedorId != null
                  ? { proveedorId: concepto.proveedorId }
                  : concepto.proveedorTexto != null
                    ? { proveedorTexto: concepto.proveedorTexto }
                    : { sinProveedor: true as const };
```

- [ ] **Step 2: Typecheck y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores

- [ ] **Step 3: Verificación manual**

Levantar el dev server (`npm run dev`), ir al dashboard, vista "Compras x Proveedor", y confirmar:
- Bajo cualquier rubro, aparecen nodos separados con nombres como "Diego", "GASTOS VARIOS", etc. en vez de un único "Sin Proveedor".
- Clickear el total de uno de esos nodos (ej. "Diego") abre el modal de detalle mostrando **solo** las compras de Diego, no las de todos los que no tienen proveedor.
- El tooltip de composición (si el concepto tiene una regla de Apertura activa) muestra el reparto correcto para ese proveedor de texto, sin mezclarse con otro.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/pivot-table-por-proveedor.tsx
git commit -m "feat(dashboard): drill-down de la vista por proveedor filtra por texto crudo, no todo 'sin proveedor' junto"
```

---

## Self-Review

**1. Cobertura del spec:** §3.1 (normalización compartida) → Task 1-2. §3.2 (árbol) → Task 3. §3.3 (composición) → Task 4. §3.4 (drill-down) → Task 5-6. §4 (testing) → cubierto por task, con la excepción documentada de la Task 6 (sin tests de componentes en este proyecto). Sin gaps.

**2. Placeholders:** ninguno — todo el código de cada step es real y completo.

**3. Consistencia de tipos:** `normalizarTexto` (Task 1) se usa con la misma firma en Task 2, 3 y 4. El formato de clave `texto:${normalizarTexto(...)}` es idéntico en `pivot-por-proveedor.ts` (Task 3) y `apertura-composicion.ts` (Task 4) — verificado carácter por carácter, ya que un desajuste ahí haría que el tooltip nunca encuentre su composición. `proveedorTexto` como nombre de campo es consistente entre `PivotProveedorSubRow`/`PivotConceptoSubRow` (Task 3), `DetalleFilter` (Task 5) y su uso en el componente (Task 6). `ComposicionSqlRow`/`ComposicionOriginalRow` ganan `proveedor_nombre` en Task 4, y las dos queries SQL que los alimentan (en `app/api/dashboard/pivot/route.ts`) se actualizan en la misma task para no dejar el tipo desincronizado del resultado real de la query.
