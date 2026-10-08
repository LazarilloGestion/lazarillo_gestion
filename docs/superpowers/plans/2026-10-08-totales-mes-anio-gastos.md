# Totales de mes/año clickeables + drill-down que respeta filtros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el pie "Total {año}" de la tabla de gastos abra el modal de detalle por mes y por año, y que todo drill-down de compras respete los filtros activos del dashboard, sin truncado silencioso.

**Architecture:** El armado del `DetalleFilter` se centraliza en una función pura (`buildDetalleFilter`) que usan los dos hooks de pantalla pivot. Las condiciones SQL de `GET /api/dashboard/detalle` se extraen a una función pura testeable (`buildDetalleConditions`) que suma observación, lista de meses y visibilidad por rubro efectivo; la ruta recorta a 5000 filas y devuelve `hasMore`. La UI agrega callbacks opcionales al pie y un aviso en el modal.

**Tech Stack:** Next.js 16 (route handlers), React 19, TypeScript estricto, Prisma 7 (`Prisma.sql` raw), Zod, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-totales-mes-anio-gastos-design.md`

## Global Constraints

- No se modifica ningún dato de compras/ventas: solo lectura + UI. Ninguna tarea corre scripts contra la base.
- No se agregan dependencias.
- No se toca Ventas (pivot ni modal) ni el criterio `visibleEnResultados` del detalle.
- Datos externos (query params) se validan con Zod vía `safeParse`; inválido = sin filtro (criterio existente de la ruta, no 400).
- Límite del detalle de compras: **5000** filas; la query pide 5001.
- Texto del aviso: `Se muestran los primeros 5.000 registros — filtrá por mes para ver el resto.` (el shell es genérico, por eso "registros" y no "compras"; el número sale del conteo real).
- Conventional Commits, cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `npx vitest run <archivo>`; suite completa: `npm test`. Antes de cerrar: `npm run lint` y `npm run build`.
- Comentarios en español, explicando el "por qué" (estilo del repo).

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `lib/dashboard/query-builders.ts` | Modify | extrae `observacionCondition` (compartido pivot/detalle) |
| `lib/dashboard/query-builders.test.ts` | Modify | test directo de `observacionCondition` |
| `lib/dashboard/constants.ts` | Modify | `DETALLE_COMPRAS_LIMITE = 5000` |
| `lib/dashboard/recortar-has-more.ts` | Create | recorte N+1 → N + `hasMore` |
| `lib/dashboard/recortar-has-more.test.ts` | Create | tests |
| `lib/dashboard/types.ts` | Modify | `DetalleFilter.observacionQuery`, `DetalleFilter.meses` |
| `lib/dashboard/params.ts` | Modify | exporta `monthsParam`; `buildComprasDetalleUrl` serializa `months`/`observacionQuery` |
| `lib/dashboard/params.test.ts` | Modify | tests de URL |
| `lib/dashboard/detalle-filter.ts` | Create | `buildDetalleFilter` (precedencia click > globales) |
| `lib/dashboard/detalle-filter.test.ts` | Create | tests de la tabla de precedencia |
| `lib/dashboard/detalle-conditions.ts` | Create | `buildDetalleConditions` (WHERE del detalle) |
| `lib/dashboard/detalle-conditions.test.ts` | Create | tests SQL |
| `app/api/dashboard/detalle/route.ts` | Modify | usa `buildDetalleConditions`, parsea `months`/`observacionQuery`, `hasMore` |
| `hooks/use-pivot-screen-data.ts` | Modify | `openDetalle` vía `buildDetalleFilter` |
| `hooks/use-pivot-screen-data-por-proveedor.ts` | Modify | ídem |
| `hooks/use-resultados-data.ts` | Modify | pasa `rubroCodigo`, `activeMonths` |
| `components/dashboard/pivot-table-por-concepto.tsx` | Modify | pasa `rubroCodigo`, `activeMonths`; cablea pie |
| `components/dashboard/pivot-table-por-proveedor.tsx` | Modify | ídem |
| `components/dashboard/pivot-table-foot.tsx` | Modify | `onMonthClick`/`onTotalClick` opcionales |
| `components/dashboard/detalle-modal-shell.tsx` | Modify | aviso `hasMore` |

---

### Task 1: Helper compartido de búsqueda por observación

**Files:**
- Modify: `lib/dashboard/query-builders.ts:89-93` (bloque `if (observacionQuery)` dentro de `buildPivotConditions`)
- Test: `lib/dashboard/query-builders.test.ts`

**Interfaces:**
- Produces: `export function observacionCondition(t: string, query: string): Prisma.Sql` en `lib/dashboard/query-builders.ts`. `t` es el alias de tabla (constante del código, nunca input).

- [ ] **Step 1: Write the failing test**

En `lib/dashboard/query-builders.test.ts`, cambiar el import de la línea 2 a:

```ts
import { buildPivotConditions, observacionCondition, sinRubroVisibleSql } from "./query-builders";
```

y agregar al final del archivo:

```ts
describe("observacionCondition", () => {
  it("compara la observación efectiva sin acentos, con los comodines escapados", () => {
    const cond = observacionCondition("c", "Eléctrico 50%_a");
    expect(cond.sql).toContain(`translate(COALESCE(c."observacManual", c.observac),`);
    expect(cond.sql).toContain("ILIKE");
    expect(cond.values).toContain("%Electrico 50\\%\\_a%");
  });

  it("escapa también la barra invertida", () => {
    expect(observacionCondition("c", "a\\b").values).toContain("%a\\\\b%");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/query-builders.test.ts`
Expected: FAIL en `observacionCondition` con `observacionCondition is not a function`.

- [ ] **Step 3: Write minimal implementation**

En `lib/dashboard/query-builders.ts`, agregar después de `sinRubroVisibleSql` (antes de `buildPivotConditions`):

```ts
// Búsqueda por contenido en la observación efectiva (manual si existe), sin acentos de ningún lado y
// con los comodines de LIKE escapados. Compartida entre el pivot y el detalle: si filtraran distinto,
// la suma del modal no coincidiría con el total clickeado.
export function observacionCondition(t: string, query: string): Prisma.Sql {
  const q = `%${quitarAcentos(query).replace(/[%_\\]/g, "\\$&")}%`;
  return Prisma.sql`translate(COALESCE(${Prisma.raw(t)}."observacManual", ${Prisma.raw(t)}.observac), ${ACENTOS_DESDE}, ${ACENTOS_HACIA}) ILIKE ${q}`;
}
```

y reemplazar el bloque dentro de `buildPivotConditions`:

```ts
  if (observacionQuery) {
    const q = `%${quitarAcentos(observacionQuery).replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      Prisma.sql`translate(COALESCE(${Prisma.raw(t)}."observacManual", ${Prisma.raw(t)}.observac), ${ACENTOS_DESDE}, ${ACENTOS_HACIA}) ILIKE ${q}`
    );
  }
```

por:

```ts
  if (observacionQuery) conditions.push(observacionCondition(t, observacionQuery));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/query-builders.test.ts`
Expected: PASS (incluidos los tests existentes `buildPivotConditions — observación`).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/query-builders.ts lib/dashboard/query-builders.test.ts
git commit -m "refactor(dashboard): extrae observacionCondition para compartir con el detalle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Recorte con `hasMore`

**Files:**
- Create: `lib/dashboard/recortar-has-more.ts`
- Create: `lib/dashboard/recortar-has-more.test.ts`
- Modify: `lib/dashboard/constants.ts` (agregar constante al final)

**Interfaces:**
- Produces: `export function recortarConHasMore<T>(rows: T[], limite: number): { data: T[]; hasMore: boolean }` y `export const DETALLE_COMPRAS_LIMITE = 5000` en `lib/dashboard/constants.ts`.

- [ ] **Step 1: Write the failing test**

Crear `lib/dashboard/recortar-has-more.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { recortarConHasMore } from "./recortar-has-more";

describe("recortarConHasMore", () => {
  it("menos filas que el límite: devuelve todas, sin hasMore", () => {
    expect(recortarConHasMore([1, 2], 3)).toEqual({ data: [1, 2], hasMore: false });
  });

  it("exactamente el límite: devuelve todas, sin hasMore", () => {
    expect(recortarConHasMore([1, 2, 3], 3)).toEqual({ data: [1, 2, 3], hasMore: false });
  });

  it("límite + 1 (la fila centinela): recorta al límite y marca hasMore", () => {
    expect(recortarConHasMore([1, 2, 3, 4], 3)).toEqual({ data: [1, 2, 3], hasMore: true });
  });

  it("sin filas: lista vacía, sin hasMore", () => {
    expect(recortarConHasMore([], 3)).toEqual({ data: [], hasMore: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/recortar-has-more.test.ts`
Expected: FAIL con `Failed to resolve import "./recortar-has-more"`.

- [ ] **Step 3: Write minimal implementation**

Crear `lib/dashboard/recortar-has-more.ts`:

```ts
// La query pide `limite + 1` filas: si vuelve la de más, hay registros que no se muestran. Así el
// truncado se detecta sin un COUNT(*) aparte y nunca pasa en silencio (CLAUDE.md §2).
export function recortarConHasMore<T>(rows: T[], limite: number): { data: T[]; hasMore: boolean } {
  if (rows.length <= limite) return { data: rows, hasMore: false };
  return { data: rows.slice(0, limite), hasMore: true };
}
```

Al final de `lib/dashboard/constants.ts`:

```ts
// Tope de filas del modal de detalle de compras. Un año completo sin filtro de rubro puede superar
// el tope viejo (2000); por encima de este, el modal avisa (hasMore) en vez de cortar callado.
export const DETALLE_COMPRAS_LIMITE = 5000;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/recortar-has-more.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/recortar-has-more.ts lib/dashboard/recortar-has-more.test.ts lib/dashboard/constants.ts
git commit -m "feat(dashboard): recorte con hasMore para el detalle de compras

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `DetalleFilter` con meses y observación + URL

**Files:**
- Modify: `lib/dashboard/types.ts:152-169` (`DetalleFilter`)
- Modify: `lib/dashboard/params.ts:55-59` (`monthsParam`) y `:137-153` (`buildComprasDetalleUrl`)
- Test: `lib/dashboard/params.test.ts`

**Interfaces:**
- Produces:
  - `DetalleFilter.observacionQuery?: string` y `DetalleFilter.meses?: number[]`.
  - `export const monthsParam` (Zod; `safeParse(string | null).data` → `number[] | undefined`; `undefined` si vacío, inválido o los 12 meses).
  - URL: `mes` presente → `mes=N` y **no** `months`; si no, `meses` → `months=1,2,3`. `observacionQuery` → `observacionQuery=...`.

- [ ] **Step 1: Write the failing test**

Al final de `lib/dashboard/params.test.ts` (y agregar `monthsParam` al import de la línea 2):

```ts
describe("buildComprasDetalleUrl — meses y observación", () => {
  it("serializa meses como months coma-separado", () => {
    const sp = new URL(buildComprasDetalleUrl({ year: 2026, meses: [1, 2, 3] }), "http://x").searchParams;
    expect(sp.get("months")).toBe("1,2,3");
  });

  it("con mes, manda mes y no months (el mes clickeado gana)", () => {
    const sp = new URL(buildComprasDetalleUrl({ year: 2026, mes: 2, meses: [1, 2, 3] }), "http://x").searchParams;
    expect(sp.get("mes")).toBe("2");
    expect(sp.has("months")).toBe(false);
  });

  it("serializa observacionQuery", () => {
    const sp = new URL(buildComprasDetalleUrl({ year: 2026, observacionQuery: "luz 50%" }), "http://x").searchParams;
    expect(sp.get("observacionQuery")).toBe("luz 50%");
  });

  it("sin meses ni observación no agrega esos params", () => {
    const url = buildComprasDetalleUrl({ year: 2026 });
    expect(url).not.toContain("months");
    expect(url).not.toContain("observacionQuery");
  });
});

describe("monthsParam", () => {
  it("parsea una lista válida", () => {
    expect(monthsParam.safeParse("1,3").data).toEqual([1, 3]);
  });

  it("los 12 meses equivalen a sin filtro", () => {
    expect(monthsParam.safeParse("1,2,3,4,5,6,7,8,9,10,11,12").data).toBeUndefined();
  });

  it("ausente o vacío: sin filtro", () => {
    expect(monthsParam.safeParse(null).data).toBeUndefined();
    expect(monthsParam.safeParse("").data).toBeUndefined();
  });

  it("un mes no entero falla el safeParse (la ruta lo trata como sin filtro)", () => {
    expect(monthsParam.safeParse("1.5").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/params.test.ts`
Expected: FAIL — `monthsParam` undefined y `months`/`observacionQuery` ausentes en la URL. (También error de tipos en `meses`/`observacionQuery`; vitest no typechequea, así que el fallo visible es de aserción.)

- [ ] **Step 3: Write minimal implementation**

En `lib/dashboard/types.ts`, dentro de `DetalleFilter`, después de `distribucionId?: number;`:

```ts
  // Búsqueda por contenido en la observación — filtro global del dashboard, para que el modal
  // muestre las mismas compras que suma la celda clickeada.
  observacionQuery?: string;
  // Selección parcial de meses del dashboard. Se ignora si viene `mes` (la celda de un mes puntual).
  meses?: number[];
```

En `lib/dashboard/params.ts`, línea 55: `const monthsParam = ...` → `export const monthsParam = ...` (sin otros cambios).

En `buildComprasDetalleUrl`, reemplazar:

```ts
  if (filter.mes) params.set("mes", String(filter.mes));
```

por:

```ts
  if (filter.mes) params.set("mes", String(filter.mes));
  else if (filter.meses?.length) params.set("months", filter.meses.join(","));
  if (filter.observacionQuery) params.set("observacionQuery", filter.observacionQuery);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/params.test.ts`
Expected: PASS (nuevos y existentes).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/types.ts lib/dashboard/params.ts lib/dashboard/params.test.ts
git commit -m "feat(dashboard): DetalleFilter admite meses y observación en la URL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `buildDetalleFilter` — precedencia click > filtros globales

**Files:**
- Create: `lib/dashboard/detalle-filter.ts`
- Create: `lib/dashboard/detalle-filter.test.ts`

**Interfaces:**
- Consumes: `DetalleFilter` (con `meses`/`observacionQuery`, Task 3).
- Produces (en `lib/dashboard/detalle-filter.ts`):
  ```ts
  export type DetalleFilterBase = Pick<DetalleFilter, "year" | "localId" | "pdvId">;
  export interface DetalleFiltrosGlobales {
    rubroCodigo?: string;
    conceptoCodigo?: string;
    proveedorId?: number;
    observacionQuery?: string;
    activeMonths?: number[];
  }
  export type DetalleFilterExtra = Omit<DetalleFilter, "year" | "localId" | "pdvId" | "observacionQuery" | "meses">;
  export function buildDetalleFilter(base: DetalleFilterBase, globales: DetalleFiltrosGlobales, extra: DetalleFilterExtra): DetalleFilter;
  ```

- [ ] **Step 1: Write the failing test**

Crear `lib/dashboard/detalle-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDetalleFilter } from "./detalle-filter";

const base = { year: 2026, localId: 1, pdvId: 2 };

describe("buildDetalleFilter", () => {
  it("sin globales: igual que antes (base + click)", () => {
    expect(buildDetalleFilter(base, {}, { mes: 3, rubroCodigo: "R1" }))
      .toEqual({ ...base, mes: 3, rubroCodigo: "R1" });
  });

  it("total anual con selección parcial de meses: manda esos meses", () => {
    expect(buildDetalleFilter(base, { activeMonths: [1, 2, 3] }, {}))
      .toEqual({ ...base, meses: [1, 2, 3] });
  });

  it("celda de un mes: gana el mes, no se mandan los meses activos", () => {
    const f = buildDetalleFilter(base, { activeMonths: [1, 2, 3] }, { mes: 2 });
    expect(f.mes).toBe(2);
    expect(f.meses).toBeUndefined();
  });

  it("arrastra los filtros globales al click del pie", () => {
    expect(buildDetalleFilter(base, { rubroCodigo: "R1", observacionQuery: "luz" }, { mes: 4 }))
      .toEqual({ ...base, mes: 4, rubroCodigo: "R1", observacionQuery: "luz" });
  });

  it("el concepto de la fila pisa el concepto global", () => {
    expect(buildDetalleFilter(base, { conceptoCodigo: "C1" }, { conceptoCodigo: "C2" }).conceptoCodigo).toBe("C2");
  });

  it("el rubro de la fila pisa el rubro global", () => {
    expect(buildDetalleFilter(base, { rubroCodigo: "R1" }, { rubroCodigo: "R2" }).rubroCodigo).toBe("R2");
  });

  it("proveedorId global se mantiene si el click no trae proveedor", () => {
    expect(buildDetalleFilter(base, { proveedorId: 9 }, { rubroCodigo: "R1" }).proveedorId).toBe(9);
  });

  it.each([
    [{ proveedorId: 5 }],
    [{ proveedorTexto: "Diego" }],
    [{ sinProveedor: true as const }],
  ])("si el click trae proveedor (%o), se descarta el proveedorId global", (extra) => {
    const f = buildDetalleFilter(base, { proveedorId: 9 }, extra);
    expect(f.proveedorId).toBe("proveedorId" in extra ? 5 : undefined);
  });

  it("click de un registro puntual (rowId): solo base + rowId/distribucionId, sin globales", () => {
    expect(buildDetalleFilter(base, { rubroCodigo: "R1", activeMonths: [1] }, { rowId: "abc", distribucionId: 7 }))
      .toEqual({ ...base, rowId: "abc", distribucionId: 7 });
  });
});
```

Nota: `toEqual` ignora propiedades con valor `undefined`, por eso los casos sin globales comparan contra objetos sin esas claves.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/detalle-filter.test.ts`
Expected: FAIL con `Failed to resolve import "./detalle-filter"`.

- [ ] **Step 3: Write minimal implementation**

Crear `lib/dashboard/detalle-filter.ts`:

```ts
import type { DetalleFilter } from "./types";

export type DetalleFilterBase = Pick<DetalleFilter, "year" | "localId" | "pdvId">;

// Filtros activos del dashboard (useDashboard). activeMonths es undefined con los 12 meses.
export interface DetalleFiltrosGlobales {
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
  activeMonths?: number[];
}

// Lo que trae el click de una celda — observación y meses solo llegan por los globales.
export type DetalleFilterExtra = Omit<DetalleFilter, "year" | "localId" | "pdvId" | "observacionQuery" | "meses">;

// Arma el filtro del modal de detalle para que muestre exactamente las compras que suma la celda
// clickeada: los totales del pivot ya vienen acotados por los filtros globales, así que el modal
// también. Ante un choque gana lo del click, que es lo más específico.
export function buildDetalleFilter(
  base: DetalleFilterBase,
  globales: DetalleFiltrosGlobales,
  extra: DetalleFilterExtra,
): DetalleFilter {
  // La API resuelve un registro puntual por rowId e ignora el resto; no arrastrar globales evita
  // que el mismo registro tenga distintos queryKey según los filtros activos.
  if (extra.rowId) return { ...base, rowId: extra.rowId, distribucionId: extra.distribucionId };

  const clickTraeProveedor =
    extra.proveedorId != null || extra.proveedorTexto != null || extra.sinProveedor === true;

  return {
    ...base,
    rubroCodigo: globales.rubroCodigo,
    conceptoCodigo: globales.conceptoCodigo,
    // proveedorId gana sobre proveedorTexto/sinProveedor en la URL — si el click es de una fila
    // de proveedor, el global taparía la fila clickeada.
    proveedorId: clickTraeProveedor ? undefined : globales.proveedorId,
    observacionQuery: globales.observacionQuery,
    meses: extra.mes ? undefined : globales.activeMonths,
    ...extra,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/detalle-filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/detalle-filter.ts lib/dashboard/detalle-filter.test.ts
git commit -m "feat(dashboard): buildDetalleFilter combina filtros globales con el click

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Condiciones SQL del detalle + ruta con meses, observación, visibilidad efectiva y `hasMore`

**Files:**
- Create: `lib/dashboard/detalle-conditions.ts`
- Create: `lib/dashboard/detalle-conditions.test.ts`
- Modify: `app/api/dashboard/detalle/route.ts:125-207` (parseo de params de lista + WHERE + LIMIT + respuesta) y las dos respuestas de la rama `rowId` (`:92`, `:123`)

**Interfaces:**
- Consumes: `observacionCondition` (Task 1), `recortarConHasMore` + `DETALLE_COMPRAS_LIMITE` (Task 2), `monthsParam` (Task 3).
- Produces:
  ```ts
  export interface DetalleConditionParams {
    year: number;
    localId?: number;
    pdvId?: number;
    mes?: number;
    meses?: number[];
    proveedorId?: number;
    proveedorTexto?: string;
    codigo?: string;
    sinProveedor: boolean;
    rubroCodigo?: string;
    conceptoCodigo?: string;
    observacionQuery?: string;
  }
  export function buildDetalleConditions(p: DetalleConditionParams): Prisma.Sql[];
  ```
  Asume los alias de la query de la ruta: `c` (v_compras_distribuidas), `p` (proveedores), `rc_ef` (rubro efectivo).
- Respuesta de la API: `{ data: CompraDetalle[], hasMore: boolean }` en todas las ramas.

- [ ] **Step 1: Write the failing test**

Crear `lib/dashboard/detalle-conditions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDetalleConditions } from "./detalle-conditions";

const base = { year: 2026, sinProveedor: false };
const sqlDe = (conds: ReturnType<typeof buildDetalleConditions>) => conds.map((c) => c.sql).join(" AND ");
const valuesDe = (conds: ReturnType<typeof buildDetalleConditions>) => conds.flatMap((c) => c.values);

describe("buildDetalleConditions — visibilidad", () => {
  it("sin rubro ni concepto: oculta por rubro EFECTIVO (mismo criterio que el pivot)", () => {
    const sql = sqlDe(buildDetalleConditions(base));
    expect(sql).toContain(`rc_ef."visibleEnDashboard" = true`);
    expect(sql).toContain("rc_ef.codigo IS NULL");
    expect(sql).not.toContain(`rc."visibleEnDashboard"`);
    expect(sql).not.toContain(`c."conceptoCodigo" IS NULL`);
  });

  it("con rubro: filtra por rubro efectivo con bucket Sin Rubro, sin filtro de visibilidad", () => {
    const conds = buildDetalleConditions({ ...base, rubroCodigo: "R1" });
    expect(sqlDe(conds)).toContain("COALESCE(rc_ef.codigo, '__sin_rubro') =");
    expect(valuesDe(conds)).toContain("R1");
    expect(sqlDe(conds)).not.toContain("visibleEnDashboard");
  });

  it("con concepto: gana sobre rubro", () => {
    const conds = buildDetalleConditions({ ...base, rubroCodigo: "R1", conceptoCodigo: "C1" });
    expect(sqlDe(conds)).toContain(`COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") =`);
    expect(valuesDe(conds)).toContain("C1");
    expect(valuesDe(conds)).not.toContain("R1");
  });
});

describe("buildDetalleConditions — período", () => {
  it("con meses y sin mes: filtra el año y esos meses", () => {
    const conds = buildDetalleConditions({ ...base, meses: [1, 3] });
    expect(sqlDe(conds)).toContain("EXTRACT(MONTH FROM");
    expect(valuesDe(conds)).toEqual(expect.arrayContaining([1, 3, new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2027, 0, 1))]));
  });

  it("con mes: rango de ese mes y se ignoran los meses", () => {
    const conds = buildDetalleConditions({ ...base, mes: 3, meses: [1, 3] });
    expect(sqlDe(conds)).not.toContain("EXTRACT(MONTH FROM");
    expect(valuesDe(conds)).toEqual(expect.arrayContaining([new Date(Date.UTC(2026, 2, 1)), new Date(Date.UTC(2026, 3, 1))]));
  });

  it("sin mes ni meses: año completo, sin filtro de meses", () => {
    expect(sqlDe(buildDetalleConditions(base))).not.toContain("EXTRACT(MONTH FROM");
  });
});

describe("buildDetalleConditions — observación y proveedor", () => {
  it("con observación: usa el mismo ILIKE sin acentos que el pivot", () => {
    const conds = buildDetalleConditions({ ...base, observacionQuery: "eléctrico" });
    expect(sqlDe(conds)).toContain(`translate(COALESCE(c."observacManual", c.observac),`);
    expect(valuesDe(conds)).toContain("%electrico%");
  });

  it("proveedorId gana sobre proveedorTexto y sinProveedor", () => {
    const sql = sqlDe(buildDetalleConditions({ ...base, proveedorId: 5, proveedorTexto: "Diego", sinProveedor: true }));
    expect(sql).toContain("p.id =");
    expect(sql).not.toContain("c.proveedor =");
  });

  it("proveedorTexto con código acota por código", () => {
    const conds = buildDetalleConditions({ ...base, proveedorTexto: "Abril", codigo: "368" });
    expect(sqlDe(conds)).toContain("c.codigo =");
    expect(valuesDe(conds)).toEqual(expect.arrayContaining(["Abril", "368"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/detalle-conditions.test.ts`
Expected: FAIL con `Failed to resolve import "./detalle-conditions"`.

- [ ] **Step 3: Write `lib/dashboard/detalle-conditions.ts`**

El código de proveedor/rubro/concepto se **mueve** desde la ruta con sus comentarios; cambian solo la rama de visibilidad y se agregan meses/observación.

```ts
import { Prisma } from "@prisma/client";
import { buildDateRange, observacionCondition, sinRubroVisibleSql } from "./query-builders";

export interface DetalleConditionParams {
  year: number;
  localId?: number;
  pdvId?: number;
  mes?: number;
  // Selección parcial de meses — se ignora si viene `mes`.
  meses?: number[];
  proveedorId?: number;
  proveedorTexto?: string;
  codigo?: string;
  sinProveedor: boolean;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  observacionQuery?: string;
}

// WHERE de la lista de /api/dashboard/detalle. Extraído de la ruta para poder testearlo: el modal
// tiene que traer exactamente las compras que suma la celda clickeada del pivot, así que cada
// predicado replica el de buildPivotConditions. Alias que asume: c (v_compras_distribuidas),
// p (proveedores), rc_ef (rubro del concepto efectivo).
export function buildDetalleConditions({
  year, localId, pdvId, mes, meses, proveedorId, proveedorTexto, codigo, sinProveedor,
  rubroCodigo, conceptoCodigo, observacionQuery,
}: DetalleConditionParams): Prisma.Sql[] {
  const { fechaStart, fechaEnd } = buildDateRange(year, mes);

  const conditions: Prisma.Sql[] = [
    Prisma.sql`COALESCE(c."fechaManual", c.fecha) >= ${fechaStart} AND COALESCE(c."fechaManual", c.fecha) < ${fechaEnd}`,
    Prisma.sql`(c.fecha IS NOT NULL OR c."fechaManual" IS NOT NULL)`,
    Prisma.sql`COALESCE(c."importeManual", c.importe) IS NOT NULL AND COALESCE(c."importeManual", c.importe) != 0`,
  ];
  if (!mes && meses?.length) {
    conditions.push(Prisma.sql`EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int IN (${Prisma.join(meses)})`);
  }
  if (localId !== undefined) conditions.push(Prisma.sql`c."localId" = ${localId}`);
  if (pdvId !== undefined) conditions.push(Prisma.sql`c."puntoDeVentaId" = ${pdvId}`);
  if (proveedorId !== undefined) conditions.push(Prisma.sql`p.id = ${proveedorId}`);
  else if (proveedorTexto !== undefined) {
    // codigo es un AND adicional, no un reemplazo de proveedorTexto — dos
    // personas con el mismo proveedorTexto (ej. dos "Abril") solo se separan
    // si también se filtra por su código real (ver spec de la revisión final
    // de rama). Sin codigo en la URL (compatibilidad con proveedores de texto
    // crudo sin código), el filtro queda igual que antes.
    conditions.push(
      codigo !== undefined
        ? Prisma.sql`c."proveedorId" IS NULL AND c.proveedor = ${proveedorTexto} AND c.codigo = ${codigo}`
        : Prisma.sql`c."proveedorId" IS NULL AND c.proveedor = ${proveedorTexto}`
    );
  }
  else if (sinProveedor) conditions.push(Prisma.sql`c."proveedorId" IS NULL AND c.proveedor IS NULL`);

  // cc_ef/rc_ef (concepto EFECTIVO, mismo join que pivot usa: COALESCE(manual,
  // original)) es solo para filtrar. Filtrar por el concepto NO-coalescido
  // sería un bug: una compra reclasificada a mano a otro rubro/concepto
  // dejaría de aparecer al filtrar por su rubro nuevo, o seguiría apareciendo
  // en el rubro viejo.
  if (rubroCodigo && !conceptoCodigo) {
    // Mismo criterio que el pivot (query-builders.ts) y el SELECT de
    // /api/dashboard/pivot: el bucket "Sin Rubro" es sintético
    // ('__sin_rubro'), no existe como código real en rubros_concepto_caja.
    // Sin el COALESCE, rc_ef.codigo es NULL para esas compras y
    // `NULL = '__sin_rubro'` nunca matchea — el modal abre vacío.
    conditions.push(Prisma.sql`COALESCE(rc_ef.codigo, '__sin_rubro') = ${rubroCodigo}`);
  } else if (conceptoCodigo) {
    conditions.push(Prisma.sql`COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${conceptoCodigo}`);
  } else {
    // Sin filtro de rubro/concepto: excluir rubros ocultos con el rubro
    // EFECTIVO, igual que buildPivotConditions. Antes se usaba el concepto
    // original: una compra reclasificada a mano entre un rubro visible y uno
    // oculto hacía que la suma del modal no coincidiera con el total del pie
    // (spec 2026-10-08-totales-mes-anio-gastos).
    conditions.push(
      Prisma.sql`(rc_ef."visibleEnDashboard" = true OR (rc_ef.codigo IS NULL AND ${sinRubroVisibleSql("visibleEnDashboard")}))`
    );
  }

  if (observacionQuery) conditions.push(observacionCondition("c", observacionQuery));

  return conditions;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/detalle-conditions.test.ts`
Expected: PASS.

Si falla el test de `meses` por la forma de `values` de `Prisma.join`, inspeccionar con `console.log(valuesDe(conds))` y ajustar **el test** solo si los valores están presentes con otra forma; si faltan, el bug está en la implementación.

- [ ] **Step 5: Usar `buildDetalleConditions` en la ruta**

En `app/api/dashboard/detalle/route.ts`:

1. Imports — reemplazar:
   ```ts
   import { mesSchema, yearSchema, idSchema, codigoSchema, textoLibreSchema } from "@/lib/dashboard/schemas";
   import { buildDateRange, sinRubroVisibleSql } from "@/lib/dashboard/query-builders";
   ```
   por:
   ```ts
   import { mesSchema, yearSchema, idSchema, codigoSchema, textoLibreSchema } from "@/lib/dashboard/schemas";
   import { monthsParam } from "@/lib/dashboard/params";
   import { buildDetalleConditions } from "@/lib/dashboard/detalle-conditions";
   import { recortarConHasMore } from "@/lib/dashboard/recortar-has-more";
   import { DETALLE_COMPRAS_LIMITE } from "@/lib/dashboard/constants";
   ```

2. Rama `rowId` con `distribucionId` (línea ~92): `return NextResponse.json({ data: rows.map(reshapeDetalle) });` → `return NextResponse.json({ data: rows.map(reshapeDetalle), hasMore: false });`

3. Rama `rowId` sin `distribucionId` (línea ~123): `return NextResponse.json({ data: compra ? [{ ...compra, distribucionId: null }] : [] });` → `return NextResponse.json({ data: compra ? [{ ...compra, distribucionId: null }] : [], hasMore: false });`

4. Después de `const rubroCodigo = rubroCodigoRaw ? ...` agregar:
   ```ts
   const meses = monthsParam.safeParse(searchParams.get("months")).data;
   const observacionRaw = searchParams.get("observacionQuery");
   const observacionQuery = observacionRaw ? textoLibreSchema.safeParse(observacionRaw).data : undefined;
   ```

5. Borrar desde `const { fechaStart, fechaEnd } = buildDateRange(year, mes);` hasta `const where = Prisma.join(conditions, " AND ");` inclusive (todo ese bloque ahora vive en `buildDetalleConditions`) y poner en su lugar:
   ```ts
   const where = Prisma.join(
     buildDetalleConditions({
       year, localId, pdvId, mes, meses, proveedorId, proveedorTexto, codigo, sinProveedor,
       rubroCodigo, conceptoCodigo, observacionQuery,
     }),
     " AND "
   );
   ```

6. En la query de lista: `LIMIT 2000` → `LIMIT ${DETALLE_COMPRAS_LIMITE + 1}`, y reemplazar
   ```ts
   return NextResponse.json({ data: rows.map(reshapeDetalle) });
   ```
   (el del `try`, no los de la rama rowId) por:
   ```ts
   const { data, hasMore } = recortarConHasMore(rows, DETALLE_COMPRAS_LIMITE);
   return NextResponse.json({ data: data.map(reshapeDetalle), hasMore });
   ```

- [ ] **Step 6: Typecheck y tests**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores de tipos; toda la suite PASS. Si `tsc` marca `Prisma` sin usar en la ruta, no aplica: `Prisma.sql`/`Prisma.join` se siguen usando ahí.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/detalle-conditions.ts lib/dashboard/detalle-conditions.test.ts app/api/dashboard/detalle/route.ts
git commit -m "feat(api): detalle de compras filtra por meses y observación, avisa truncado

Alinea la visibilidad de rubros ocultos con el pivot (rubro efectivo) y
sube el tope a 5000 filas devolviendo hasMore en vez de cortar callado.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Los hooks de pantalla arman el filtro con `buildDetalleFilter`

**Files:**
- Modify: `hooks/use-pivot-screen-data.ts:5-17` (params), `:22-24` (firma), `:50-52` (`openDetalle`)
- Modify: `hooks/use-pivot-screen-data-por-proveedor.ts:5-17`, `:23-25`, `:54-56`
- Modify: `hooks/use-resultados-data.ts:31-35`
- Modify: `components/dashboard/pivot-table-por-concepto.tsx:41-45`
- Modify: `components/dashboard/pivot-table-por-proveedor.tsx:41-45`

**Interfaces:**
- Consumes: `buildDetalleFilter`, `DetalleFilterExtra` (Task 4).
- Produces: ambos hooks aceptan `rubroCodigo?: string` y `activeMonths?: number[]`; `openDetalle(extra: DetalleFilterExtra)`.

Sin tests nuevos (la lógica está en `buildDetalleFilter`, ya testeada); verificación por tipos + suite.

- [ ] **Step 1: `hooks/use-pivot-screen-data.ts`**

Import: reemplazar
```ts
import type { PivotData, DetalleFilter, VentasDetalleFilter } from "@/lib/dashboard/types";
```
por
```ts
import type { PivotData, DetalleFilter, VentasDetalleFilter } from "@/lib/dashboard/types";
import { buildDetalleFilter, type DetalleFilterExtra } from "@/lib/dashboard/detalle-filter";
```

En `UsePivotScreenDataParams`, después de `observacionQuery?: string;`:
```ts
  rubroCodigo?: string;
  activeMonths?: number[];
```

Firma: `data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,` → `data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery, rubroCodigo, activeMonths,`

`openDetalle`:
```ts
  // Los totales del pivot vienen acotados por los filtros del dashboard; el modal tiene que mostrar
  // las mismas compras (ver buildDetalleFilter).
  function openDetalle(extra: DetalleFilterExtra) {
    setDetalleFilter(buildDetalleFilter(
      { year, localId, pdvId },
      { rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, activeMonths },
      extra,
    ));
  }
```

- [ ] **Step 2: `hooks/use-pivot-screen-data-por-proveedor.ts`**

Mismos tres cambios: import de `buildDetalleFilter`/`DetalleFilterExtra` junto al import de tipos, los dos campos nuevos en `UsePivotScreenDataPorProveedorParams` después de `observacionQuery?: string;`, `rubroCodigo, activeMonths,` al final del destructuring de la firma, y `openDetalle` idéntico al del Step 1 (mismo código, con el mismo comentario).

- [ ] **Step 3: Callers**

`components/dashboard/pivot-table-por-concepto.tsx` y `components/dashboard/pivot-table-por-proveedor.tsx` — en la llamada al hook, la línea
```ts
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
```
pasa a
```ts
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
    rubroCodigo, activeMonths,
```
(`rubroCodigo` y `activeMonths` ya están desestructurados de `useDashboard()` en ambos componentes.)

`hooks/use-resultados-data.ts` — misma línea en la llamada a `usePivotScreenData`, mismo agregado (`rubroCodigo` y `activeMonths` ya vienen de `useDashboard()` en ese hook).

- [ ] **Step 4: Typecheck y tests**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores; suite PASS. Si `tsc` marca algún `openDetalle(...)` existente por pasar `observacionQuery`/`meses`, es un uso nuevo no previsto: parar y revisar (hoy ningún caller los pasa).

- [ ] **Step 5: Commit**

```bash
git add hooks/use-pivot-screen-data.ts hooks/use-pivot-screen-data-por-proveedor.ts hooks/use-resultados-data.ts components/dashboard/pivot-table-por-concepto.tsx components/dashboard/pivot-table-por-proveedor.tsx
git commit -m "fix(dashboard): el drill-down de compras respeta los filtros activos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pie clickeable por mes y año + aviso de truncado en el modal

**Files:**
- Modify: `components/dashboard/pivot-table-foot.tsx`
- Modify: `components/dashboard/pivot-table-por-concepto.tsx` (`<PivotTableFoot ... />`, ~línea 239)
- Modify: `components/dashboard/pivot-table-por-proveedor.tsx` (`<PivotTableFoot ... />`, ~línea 315)
- Modify: `components/dashboard/detalle-modal-shell.tsx`

**Interfaces:**
- Consumes: `openDetalle(extra: DetalleFilterExtra)` (Task 6), `hasMore` en la respuesta (Task 5).
- Produces: `PivotTableFoot` acepta `onMonthClick?: (mes: number) => void` y `onTotalClick?: () => void`.

Sin tests de componentes en el repo: verificación por lint/build + pasada visual del usuario.

- [ ] **Step 1: `pivot-table-foot.tsx` — reemplazar el archivo completo**

```tsx
import { cn, fmtARS } from "@/lib/utils";
import { hasValue } from "@/lib/dashboard/pivot-utils";

interface PivotTableFootProps {
  year: number;
  months: number[];
  columnTotals: Record<number, number>;
  grandTotal: number;
  pctMode: "ingresos" | "egresos";
  fmtPct: (rowTotal: number) => string;
  // Opcionales: sin callback la celda se renderiza como texto plano.
  onMonthClick?: (mes: number) => void;
  onTotalClick?: () => void;
}

const CLICKABLE = "cursor-pointer hover:text-primary transition-colors";

// <tfoot> completo de la tabla pivot de compras — idéntico byte a byte entre
// pivot-table-por-concepto.tsx y pivot-table-por-proveedor.tsx antes de esta
// extracción. Los totales por mes/año abren el detalle del período (pedido
// del cliente: buscar registros por período, no solo por rubro).
export function PivotTableFoot({
  year, months, columnTotals, grandTotal, pctMode, fmtPct, onMonthClick, onTotalClick,
}: PivotTableFootProps) {
  const totalClickable = onTotalClick && hasValue(grandTotal);
  return (
    <tfoot>
      <tr className="border-t-2 bg-muted font-semibold text-[15px]">
        <td className="sticky left-0 z-10 bg-muted px-4 py-3 shadow-[1px_0_0_0_hsl(var(--border))]">
          Total {year}
        </td>
        {months.map((mes) => {
          const clickable = onMonthClick && hasValue(columnTotals[mes]);
          return (
            <td
              key={mes}
              className={cn("text-right px-3 py-3 tabular-nums bg-muted", clickable && CLICKABLE)}
              onClick={clickable ? () => onMonthClick?.(mes) : undefined}
            >
              {fmtARS(columnTotals[mes])}
            </td>
          );
        })}
        <td
          className={cn("text-right px-4 py-3 tabular-nums text-primary bg-muted", totalClickable && CLICKABLE)}
          onClick={totalClickable ? onTotalClick : undefined}
        >
          {fmtARS(grandTotal)}
        </td>
        <td className="text-right px-3 py-3 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap font-semibold bg-muted">
          {pctMode === "egresos" ? "—" : fmtPct(grandTotal)}
        </td>
      </tr>
    </tfoot>
  );
}
```

- [ ] **Step 2: Cablear el pie en las dos tablas**

En `pivot-table-por-concepto.tsx` y `pivot-table-por-proveedor.tsx`, agregar a `<PivotTableFoot ... />` después de `fmtPct={fmtPct}`:

```tsx
            onMonthClick={(mes) => openDetalle({ mes })}
            onTotalClick={() => openDetalle({})}
```

- [ ] **Step 3: Aviso en `detalle-modal-shell.tsx`**

Agregar al import de lucide (nuevo import):
```tsx
import { TriangleAlert } from "lucide-react";
```

Inmediatamente antes de `{!isLoading && !error && count > 0 && (` (el bloque de la tabla), agregar:

```tsx
        {/* La API recorta en DETALLE_COMPRAS_LIMITE: el corte nunca puede pasar callado. */}
        {!isLoading && !error && response?.hasMore && (
          <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-6 py-2 text-xs text-foreground shrink-0">
            <TriangleAlert className="size-3.5 shrink-0 text-warning" />
            Se muestran los primeros {count.toLocaleString("es-AR")} registros — filtrá por mes para ver el resto.
          </div>
        )}
```

- [ ] **Step 4: Lint, build y suite**

Run: `npm run lint && npm test && npm run build`
Expected: lint sin errores nuevos, suite PASS, build OK.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/pivot-table-foot.tsx components/dashboard/pivot-table-por-concepto.tsx components/dashboard/pivot-table-por-proveedor.tsx components/dashboard/detalle-modal-shell.tsx
git commit -m "feat(dashboard): totales de mes y año abren el detalle de gastos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verificación final

- [ ] **Step 1:** `npm test` → toda la suite PASS (anotar cantidad).
- [ ] **Step 2:** `npm run lint` → sin errores.
- [ ] **Step 3:** `npm run build` → OK.
- [ ] **Step 4:** Pasada visual del usuario (lectura, no toca datos). Checklist para el usuario:
  1. Gastos (por concepto): click en un mes del pie → modal con las compras de ese mes; la suma coincide con la celda.
  2. Click en el total anual del pie → modal del año.
  3. Seleccionar ene–mar en el filtro de meses → click en total anual → solo ene–mar; click en el total de un rubro → solo ene–mar de ese rubro.
  4. Buscar por observación (ej. "luz") → click en el pie y en un rubro → solo compras con esa observación.
  5. Vista por proveedor: mismos puntos 1–2.
  6. Resultados: click en un rubro con filtro de meses → respeta los meses.
- [ ] **Step 5:** Si algo no coincide, `superpowers:systematic-debugging` — no parchear a ciegas.
