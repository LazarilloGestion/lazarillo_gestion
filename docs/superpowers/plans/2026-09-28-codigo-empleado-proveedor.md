# Código de empleado en Compras x Proveedor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show "código - nombre" for proveedor rows under rubro "Gastos En Personal" in the Compras x Proveedor dashboard view, sourcing the code from `Compra.codigo` (not `Proveedor.codigo`), and fix the underlying grouping bug where proveedores without a real `proveedorId` link were being merged by name alone — mixing money from different real people who share a first name.

**Architecture:** `Compra.codigo` (the raw ERP code, column D of the imported Excel) is not currently exposed by the `v_compras_distribuidas` view the dashboard reads from — a Prisma migration adds it. The dashboard's proveedor-grouping key (`lib/dashboard/pivot-por-proveedor.ts`) and Apertura de Gastos' rule-matching key (`lib/apertura/motor.ts`, `lib/apertura/reevaluacion.ts`) share one format on purpose (`texto:<normalizado>` for proveedores without a real link) — both get extended to `texto:<normalizado>|codigo:<codigo>` so grouping and rule-matching never diverge. The composition tooltip (`lib/dashboard/apertura-composicion.ts`) uses the same key format independently and needs the same extension.

**Tech Stack:** Next.js 16 (API routes), Prisma 7 + `@prisma/adapter-pg` (raw SQL via `Prisma.sql`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-codigo-empleado-proveedor-design.md`

## Global Constraints

- Prefix format is exactly `"<codigo> - <nombre>"` (space, hyphen, space) — spec §2.1.
- The prefix is shown ONLY for `rubroCodigo === "3"` (Gastos En Personal) — spec §2.3. All other rubros show the name unchanged.
- The grouping-key change (`texto:<normalizado>` → `texto:<normalizado>|codigo:<codigo>`) applies to **every** rubro, not just rubro 3 — spec §2.5. A proveedor with no code (`codigo` null) keeps the old key format unchanged (no `|codigo:` suffix) — spec §2.7.
- Do not touch `Compra.proveedorTextoNormalizado` (the ETL-computed column) — match on the raw `codigo` column as a second, independent SQL condition instead — spec §3.6.
- This plan (app code) must be deployed before the separate rule-migration plan (backfill of `reglas_apertura`) runs — the old matching code doesn't understand the new `entidadId` format.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/migrations/20260928140000_v_compras_distribuidas_codigo/migration.sql` | New migration: adds `codigo` to `v_compras_distribuidas` |
| `lib/dashboard/types.ts` | `SqlRow.proveedor_codigo`, `PivotProveedorSubRow.codigo`/`.rubroCodigo` |
| `lib/dashboard/constants.ts` | New `RUBRO_GASTOS_EN_PERSONAL_CODIGO` constant |
| `lib/dashboard/pivot-por-proveedor.ts` | Grouping key gains the `|codigo:` suffix; `PivotProveedorSubRow` node gains `codigo`/`rubroCodigo` |
| `lib/dashboard/apertura-composicion.ts` | `ComposicionSqlRow`/`ComposicionOriginalRow` gain `proveedor_codigo`; `buildComposicionPorProveedor`'s `key()` gains the same suffix |
| `app/api/dashboard/pivot/route.ts` | 3 raw SQL queries select `c.codigo AS proveedor_codigo` (main rows query + 2 composition queries, with GROUP BY updated) |
| `lib/apertura/reevaluacion.ts` | `resolverEntidadIdProveedor` takes `codigo` and appends the suffix; `reevaluarCompra`'s select gains `codigo` |
| `lib/apertura/motor.ts` | `condicionMatchNivel` (nivel "proveedor", rama `texto:`) parses the optional `|codigo:` suffix and adds a second AND condition on `c.codigo` |
| `components/dashboard/pivot-table-por-proveedor.tsx` | Renders `"<codigo> - <nombre>"` when `rubroCodigo === RUBRO_GASTOS_EN_PERSONAL_CODIGO` and `codigo` is set |

Task order matters: types → constants → pure builder logic (pivot-por-proveedor, apertura-composicion) → SQL query → apertura matching (motor, reevaluacion) → UI. Each task's tests can run without the ones after it, but builder/matching logic must land before the SQL/UI tasks that feed it real data.

---

### Task 1: Prisma migration — expose `codigo` on `v_compras_distribuidas`

**Files:**
- Create: `prisma/migrations/20260928140000_v_compras_distribuidas_codigo/migration.sql`

**Interfaces:**
- Produces: a `codigo` column (type `text`, nullable) on every row of `v_compras_distribuidas`, available to any query that reads from it.

- [ ] **Step 1: Write the migration SQL**

Same shape as the current view (`prisma/migrations/20260916131712_v_compras_distribuidas_origen/migration.sql`), adding `c.codigo` to both branches of the `UNION ALL`:

```sql
-- Expone Compra.codigo (columna D del Excel de compras, ya guardado tal cual
-- viene del ERP) en la vista que alimenta el dashboard — hoy no estaba
-- expuesto, así que el código de proveedor/empleado era invisible para
-- cualquier query que lea de acá. Ver docs/superpowers/specs/
-- 2026-09-28-codigo-empleado-proveedor-design.md §3.1.
DROP VIEW v_compras_distribuidas;

CREATE VIEW v_compras_distribuidas AS
SELECT
  c."rowId",
  NULL::integer            AS "distribucionId",
  c."localId",
  c."puntoDeVentaId",
  c."localId"               AS "localIdOrigen",
  c."puntoDeVentaId"         AS "puntoDeVentaIdOrigen",
  c.importe,
  c."importeManual",
  c.fecha,
  c."fechaManual",
  c."conceptoCodigo",
  c."conceptoCodigoManual",
  c.concepto,
  c.detalle,
  c.observac,
  c."observacManual",
  c.proveedor,
  c."proveedorId",
  c.codigo
FROM compras c
WHERE c."esDistribuido" = false

UNION ALL

SELECT
  c."rowId",
  d.id                      AS "distribucionId",
  dr."localId",
  dr."puntoDeVentaId",
  c."localId"               AS "localIdOrigen",
  c."puntoDeVentaId"         AS "puntoDeVentaIdOrigen",
  d."importeCalculado"      AS importe,
  NULL::numeric             AS "importeManual",
  c.fecha,
  c."fechaManual",
  c."conceptoCodigo",
  c."conceptoCodigoManual",
  c.concepto,
  c.detalle,
  c.observac,
  c."observacManual",
  c.proveedor,
  c."proveedorId",
  c.codigo
FROM distribuciones_apertura d
JOIN compras c        ON c."rowId" = d."compraRowId"
JOIN destinos_regla dr ON dr.id    = d."destinoId"
WHERE c."esDistribuido" = true;
```

- [ ] **Step 2: Apply the migration**

Run: `npx prisma migrate dev`
Expected: prompts to apply the new migration, applies cleanly, regenerates the Prisma client. No data loss — this only changes a view definition.

- [ ] **Step 3: Verify the column is readable**

Run: `npx tsx --env-file=.env.local -e "import { prisma } from './lib/prisma'; prisma.\$queryRawUnsafe('SELECT codigo FROM v_compras_distribuidas LIMIT 1').then(r => { console.log(r); process.exit(0); })"`
Expected: prints one row with a `codigo` key (value may be a string or null), no SQL error.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/20260928140000_v_compras_distribuidas_codigo/migration.sql prisma/schema.prisma
git commit -m "feat(db): expone Compra.codigo en v_compras_distribuidas"
```

---

### Task 2: Types — `SqlRow.proveedor_codigo` and `PivotProveedorSubRow.codigo`/`.rubroCodigo`

**Files:**
- Modify: `lib/dashboard/types.ts:167-188` (`SqlRow`), `lib/dashboard/types.ts:102-114` (`PivotProveedorSubRow`)

**Interfaces:**
- Produces: `SqlRow.proveedor_codigo: string | null`, `PivotProveedorSubRow.codigo: string | null`, `PivotProveedorSubRow.rubroCodigo: string`.

This task is pure type changes with no runtime logic — no test file of its own. It compiles cleanly only once Task 3+ update every literal that constructs these types (that's normal: TypeScript will show errors in dependent files until those tasks land; if you run `npx tsc --noEmit` right after this task alone, expect errors in `pivot-por-proveedor.ts`, `pivot-por-proveedor.test.ts`, and `pivot-utils.test.ts` — that's expected, not a regression, and gets fixed by Task 3).

- [ ] **Step 1: Add `proveedor_codigo` to `SqlRow`**

In `lib/dashboard/types.ts`, find:
```ts
  proveedor_texto_crudo: string | null;
  mes: number;
```
Replace with:
```ts
  proveedor_texto_crudo: string | null;
  // Código de proveedor del ERP (columna D del Excel de compras, Compra.codigo)
  // — null cuando no hay proveedor real Y la compra no trae código. Usado para
  // desambiguar nombres ambiguos (ver pivot-table-por-proveedor.tsx) y para la
  // clave de agrupación de proveedores sin proveedorId real (ver
  // pivot-por-proveedor.ts).
  proveedor_codigo: string | null;
  mes: number;
```

- [ ] **Step 2: Add `codigo`/`rubroCodigo` to `PivotProveedorSubRow`**

Find:
```ts
export type PivotProveedorSubRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;
  readonly proveedorId: number | null;
  readonly proveedorTexto: string | null;
  readonly entidadIdProveedor: string;
```
Replace with:
```ts
export type PivotProveedorSubRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;
  readonly proveedorId: number | null;
  readonly proveedorTexto: string | null;
  // Código de proveedor del ERP — null sin proveedor real y sin código en la
  // compra. Ver proveedor_codigo en SqlRow.
  readonly codigo: string | null;
  readonly rubroCodigo: string;
  readonly entidadIdProveedor: string;
```

- [ ] **Step 3: Commit**

```bash
git add lib/dashboard/types.ts
git commit -m "feat(dashboard): suma proveedor_codigo/rubroCodigo a los tipos del pivot por proveedor"
```

---

### Task 3: Grouping key — `lib/dashboard/pivot-por-proveedor.ts`

**Files:**
- Modify: `lib/dashboard/pivot-por-proveedor.ts:25-101`
- Test: `lib/dashboard/pivot-por-proveedor.test.ts`

**Interfaces:**
- Consumes: `SqlRow.proveedor_codigo: string | null` (Task 2).
- Produces: `PivotProveedorSubRow.codigo`, `.rubroCodigo`; grouping key `provKeyOriginal` now `texto:<normalizado>|codigo:<codigo>` for texto-crudo proveedores with a code, `texto:<normalizado>` unchanged for those without one.

- [ ] **Step 1: Write the failing tests**

In `lib/dashboard/pivot-por-proveedor.test.ts`, first update the `row()` fixture helper (it constructs `SqlRow` literals — will fail to compile without `proveedor_codigo` once Task 2 landed):

```ts
function row(overrides: Partial<SqlRow>): SqlRow {
  return {
    rubro_codigo: "R1", rubro_nombre: "Rubro 1",
    concepto_codigo: "C1", concepto_nombre: "Concepto 1",
    proveedor_id: 1, proveedor_nombre: "Proveedor A", proveedor_texto_crudo: null, proveedor_codigo: "P1",
    mes: 1, total: 100, row_id: "row-1", distribucion_id: null,
    fecha: "2026-01-01", observac: null, has_manual_override: false,
    local_id_origen: null, punto_de_venta_id_origen: null,
    ...overrides,
  };
}
```

Then add these test cases (place them near the other `entidadIdProveedor`/agrupación tests):

```ts
  it("propaga codigo y rubroCodigo al nodo de proveedor", () => {
    const rows: SqlRow[] = [
      row({ rubro_codigo: "3", proveedor_id: 608, proveedor_nombre: "Santiago Benjamin", proveedor_codigo: "608", row_id: "a1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const proveedor = data.rows[0].children[0];
    expect(proveedor.codigo).toBe("608");
    expect(proveedor.rubroCodigo).toBe("3");
  });

  it("sin proveedor real, codigo llega null si la compra no trae codigo", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "Diego", proveedor_texto_crudo: "Diego", proveedor_codigo: null, row_id: "x1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    expect(data.rows[0].children[0].codigo).toBeNull();
  });

  it("dos personas con el mismo nombre pero codigo distinto: dos nodos separados, no se mezcla la plata", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "Abril", proveedor_texto_crudo: "Abril", proveedor_codigo: "368", row_id: "a1", total: 100 }),
      row({ proveedor_id: null, proveedor_nombre: "Abril", proveedor_texto_crudo: "Abril", proveedor_codigo: "670", row_id: "a2", total: 50 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const rubro = data.rows[0];
    expect(rubro.children).toHaveLength(2);
    const abril368 = rubro.children.find((p) => p.codigo === "368")!;
    const abril670 = rubro.children.find((p) => p.codigo === "670")!;
    expect(abril368.rowTotal).toBe(100);
    expect(abril670.rowTotal).toBe(50);
    expect(abril368.entidadIdProveedor).toBe("texto:abril|codigo:368");
    expect(abril670.entidadIdProveedor).toBe("texto:abril|codigo:670");
  });

  it("mismo nombre y mismo codigo en filas distintas: se siguen sumando en un solo nodo", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "Abril", proveedor_texto_crudo: "Abril", proveedor_codigo: "368", row_id: "a1", total: 100 }),
      row({ proveedor_id: null, proveedor_nombre: "Abril", proveedor_texto_crudo: "Abril", proveedor_codigo: "368", row_id: "a2", total: 50 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    expect(data.rows[0].children).toHaveLength(1);
    expect(data.rows[0].children[0].rowTotal).toBe(150);
  });

  it("proveedor real (proveedorId no null): entidadIdProveedor sigue siendo solo el id, sin sufijo de codigo", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 7, proveedor_nombre: "Proveedor G", proveedor_codigo: "7", row_id: "a1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    expect(data.rows[0].children[0].entidadIdProveedor).toBe("7");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: FAIL — `proveedor_codigo` missing from `SqlRow` literal (if Task 2 not yet merged) or `codigo`/`rubroCodigo` undefined on the returned node.

- [ ] **Step 3: Implement the grouping key change**

In `lib/dashboard/pivot-por-proveedor.ts`, find:
```ts
    const {
      rubro_codigo,
      rubro_nombre,
      proveedor_id,
      proveedor_nombre,
      proveedor_texto_crudo,
      concepto_codigo,
```
Replace with:
```ts
    const {
      rubro_codigo,
      rubro_nombre,
      proveedor_id,
      proveedor_nombre,
      proveedor_texto_crudo,
      proveedor_codigo,
      concepto_codigo,
```

Find:
```ts
    const provKeyOriginal = proveedor_id != null
      ? String(proveedor_id)
      : `texto:${normalizarTexto(proveedor_nombre)}`;
```
Replace with:
```ts
    // Con proveedor_id null, el mismo nombre puede corresponder a personas
    // reales distintas (ej. "Abril" con código 368 y otra "Abril" con código
    // 670) — sin el código en la clave, sus compras se sumarían en un solo
    // nodo. Sin código en la compra (proveedor_codigo null), no hay forma de
    // desambiguar: se mantiene el agrupado solo por nombre, igual que antes.
    // Ver docs/superpowers/specs/2026-09-28-codigo-empleado-proveedor-design.md §3.4.
    const provKeyOriginal = proveedor_id != null
      ? String(proveedor_id)
      : proveedor_codigo != null
        ? `texto:${normalizarTexto(proveedor_nombre)}|codigo:${proveedor_codigo}`
        : `texto:${normalizarTexto(proveedor_nombre)}`;
```

Find (inside the `if (!proveedorMap.has(provKey))` block, where the `PivotProveedorSubRow` object literal is constructed):
```ts
        entidadIdProveedor: provKeyOriginal,
        values: {},
        rowTotal: 0,
        children: [],
      };
      proveedorMap.set(provKey, proveedor);
```
Replace with:
```ts
        entidadIdProveedor: provKeyOriginal,
        codigo: proveedor_codigo,
        rubroCodigo: rubro_codigo,
        values: {},
        rowTotal: 0,
        children: [],
      };
      proveedorMap.set(provKey, proveedor);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: PASS, all tests including the 5 new ones.

- [ ] **Step 5: Fix the sibling fixture in `pivot-utils.test.ts`**

`lib/dashboard/pivot-utils.test.ts` has its own `proveedorRow()` helper that constructs `PivotProveedorSubRow` literals directly (not via the builder) — it needs the two new required fields too. Find:
```ts
function proveedorRow(overrides: Partial<PivotProveedorSubRow>): PivotProveedorSubRow {
  return {
    level: 1, id: "R1|1", nombre: "Proveedor A", proveedorId: 1, proveedorTexto: null, entidadIdProveedor: "1",
    values: {}, rowTotal: 0, children: [],
    ...overrides,
  };
}
```
Replace with:
```ts
function proveedorRow(overrides: Partial<PivotProveedorSubRow>): PivotProveedorSubRow {
  return {
    level: 1, id: "R1|1", nombre: "Proveedor A", proveedorId: 1, proveedorTexto: null, codigo: null, rubroCodigo: "R1", entidadIdProveedor: "1",
    values: {}, rowTotal: 0, children: [],
    ...overrides,
  };
}
```

- [ ] **Step 6: Run the full dashboard test suite and typecheck**

Run: `npx vitest run lib/dashboard/ && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/pivot-por-proveedor.ts lib/dashboard/pivot-por-proveedor.test.ts lib/dashboard/pivot-utils.test.ts
git commit -m "fix(dashboard): agrupa proveedores sin proveedorId real por nombre+codigo, no solo nombre"
```

---

### Task 4: Composition tooltip — `lib/dashboard/apertura-composicion.ts`

The pivot tree (Task 3) and the composition tooltip build their grouping key independently (by design, documented in the code) — both must move to the new format together, or the tooltip lookup silently returns nothing for texto-crudo proveedores under a rubro with codes.

**Files:**
- Modify: `lib/dashboard/apertura-composicion.ts:1-111`
- Test: `lib/dashboard/apertura-composicion.test.ts`

**Interfaces:**
- Consumes: same key format as Task 3 (`texto:<normalizado>|codigo:<codigo>` or `texto:<normalizado>`).
- Produces: `ComposicionSqlRow.proveedor_codigo`, `ComposicionOriginalRow.proveedor_codigo`; `buildComposicionPorProveedor`'s output keys gain the `|codigo:` suffix to match `PivotProveedorSubRow.entidadIdProveedor`/`.id` from Task 3.

- [ ] **Step 1: Write the failing tests**

In `lib/dashboard/apertura-composicion.test.ts`, every existing inline `ComposicionSqlRow`/`ComposicionOriginalRow` literal needs `proveedor_codigo` added once the type requires it (Step 3 below) — add it now to every literal in the file, using `proveedor_codigo: null` for `proveedor_id: 1`/`2` cases (they don't need it, `proveedorId` already disambiguates) and a real value for the `proveedor_id: null` ("Diego"/"GASTOS VARIOS") cases. Concretely, in the `buildComposicionPorProveedor` describe block, update:

```ts
  it("proveedor_id null: usa el texto crudo normalizado como clave, no un sentinela fijo", () => {
    const result = buildComposicionPorProveedor(
      [{ concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", proveedor_codigo: "120", mes: 1, destino_nombre: "X", pct: 100, importe_calculado: 500 }],
      [{ concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", proveedor_codigo: "120", mes: 1, importe_original: 500 }]
    );
    expect(result["3|texto:diego|codigo:120"][1].total).toBe(500);
  });
```

and add `proveedor_codigo: null` to every other literal in the file (both `describe` blocks) that doesn't already have it — for `proveedor_id: 1`/`2`/etc. rows, and for the "dos textos crudos distintos" / "no fusiona" test cases, pass a distinct `proveedor_codigo` per distinct `proveedor_nombre` (same convention as the "Diego" example above) so those tests keep testing what they say they test. Then add one new case:

```ts
  it("mismo nombre, codigo distinto: NO se mezclan en la misma composición", () => {
    const destinoRows = [
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Abril", proveedor_codigo: "368", mes: 1, destino_nombre: "Local A", pct: 100, importe_calculado: 100 },
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Abril", proveedor_codigo: "670", mes: 1, destino_nombre: "Local B", pct: 100, importe_calculado: 200 },
    ];
    const originalRows = [
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Abril", proveedor_codigo: "368", mes: 1, importe_original: 100 },
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Abril", proveedor_codigo: "670", mes: 1, importe_original: 200 },
    ];
    const result = buildComposicionPorProveedor(destinoRows, originalRows);
    expect(result["3|texto:abril|codigo:368"][1].destinos).toEqual([{ nombre: "Local A", pct: 100, importe: 100 }]);
    expect(result["3|texto:abril|codigo:670"][1].destinos).toEqual([{ nombre: "Local B", pct: 100, importe: 200 }]);
  });

  it("proveedor_id null y sin codigo: clave sin sufijo, igual que antes", () => {
    const result = buildComposicionPorProveedor(
      [{ concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "GASTOS VARIOS", proveedor_codigo: null, mes: 1, destino_nombre: "X", pct: 100, importe_calculado: 10 }],
      [{ concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "GASTOS VARIOS", proveedor_codigo: null, mes: 1, importe_original: 10 }]
    );
    expect(result["3|texto:gastosvarios"][1].total).toBe(10);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/dashboard/apertura-composicion.test.ts`
Expected: FAIL — TypeScript errors (missing `proveedor_codigo`) until Step 3, then assertion failures on the new key format.

- [ ] **Step 3: Implement**

In `lib/dashboard/apertura-composicion.ts`, find:
```ts
export type ComposicionSqlRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
```
Replace with:
```ts
export type ComposicionSqlRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  proveedor_codigo: string | null;
  mes: number;
```

Find:
```ts
export type ComposicionOriginalRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
```
Replace with:
```ts
export type ComposicionOriginalRow = {
  concepto_codigo: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  proveedor_codigo: string | null;
  mes: number;
```

Find:
```ts
  const key = (concepto: string, proveedorId: number | null, proveedorNombre: string) =>
    `${concepto}|${proveedorId != null ? String(proveedorId) : `texto:${normalizarTexto(proveedorNombre)}`}`;

  const ensure = (concepto: string, proveedorId: number | null, proveedorNombre: string, mes: number): ComposicionMes => {
    const k = key(concepto, proveedorId, proveedorNombre);
```
Replace with:
```ts
  // Mismo formato que provKeyOriginal en pivot-por-proveedor.ts — ver comentario
  // ahí sobre por qué el código hace falta para no mezclar personas distintas
  // que comparten nombre.
  const key = (concepto: string, proveedorId: number | null, proveedorNombre: string, proveedorCodigo: string | null) => {
    if (proveedorId != null) return `${concepto}|${proveedorId}`;
    const base = `texto:${normalizarTexto(proveedorNombre)}`;
    return `${concepto}|${proveedorCodigo != null ? `${base}|codigo:${proveedorCodigo}` : base}`;
  };

  const ensure = (concepto: string, proveedorId: number | null, proveedorNombre: string, proveedorCodigo: string | null, mes: number): ComposicionMes => {
    const k = key(concepto, proveedorId, proveedorNombre, proveedorCodigo);
```

Update both call sites of `ensure` in the same function:
```ts
  for (const row of originalRows) {
    ensure(row.concepto_codigo, row.proveedor_id, row.proveedor_nombre, row.mes).total += toNum(row.importe_original);
  }
```
→
```ts
  for (const row of originalRows) {
    ensure(row.concepto_codigo, row.proveedor_id, row.proveedor_nombre, row.proveedor_codigo, row.mes).total += toNum(row.importe_original);
  }
```
and
```ts
  for (const row of destinoRows) {
    const bucket = ensure(row.concepto_codigo, row.proveedor_id, row.proveedor_nombre, row.mes);
```
→
```ts
  for (const row of destinoRows) {
    const bucket = ensure(row.concepto_codigo, row.proveedor_id, row.proveedor_nombre, row.proveedor_codigo, row.mes);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/dashboard/apertura-composicion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/apertura-composicion.ts lib/dashboard/apertura-composicion.test.ts
git commit -m "fix(dashboard): tooltip de composición usa la misma clave nombre+codigo que el árbol de proveedores"
```

---

### Task 5: SQL query — `app/api/dashboard/pivot/route.ts`

No unit test — this task wires already-tested pure functions (Tasks 3-4) to real SQL columns. Verified via typecheck + build + the existing test suite (which exercises the pure builders, not this route directly) + a manual read-only DB check.

**Files:**
- Modify: `app/api/dashboard/pivot/route.ts:81-163`

**Interfaces:**
- Consumes: `Task 1`'s `codigo` column on `v_compras_distribuidas`; feeds `SqlRow.proveedor_codigo` / `ComposicionSqlRow.proveedor_codigo` / `ComposicionOriginalRow.proveedor_codigo` (Tasks 2 and 4).

- [ ] **Step 1: Add `proveedor_codigo` to the main rows query**

Find (around line 87-89):
```sql
      p.id                                                                AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')         AS proveedor_nombre,
      c.proveedor                                                        AS proveedor_texto_crudo,
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int        AS mes,
```
Replace with:
```sql
      p.id                                                                AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')         AS proveedor_nombre,
      c.proveedor                                                        AS proveedor_texto_crudo,
      c.codigo                                                           AS proveedor_codigo,
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int        AS mes,
```

- [ ] **Step 2: Add `proveedor_codigo` to the two composition queries (SELECT + GROUP BY)**

In `composicionDestinosQuery`, find:
```sql
      p.id                                                          AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')   AS proveedor_nombre,
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
    GROUP BY concepto_codigo, proveedor_id, proveedor_nombre, mes, destino_nombre, da.porcentaje
```
Replace with:
```sql
      p.id                                                          AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')   AS proveedor_nombre,
      c.codigo                                                     AS proveedor_codigo,
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
    GROUP BY concepto_codigo, proveedor_id, proveedor_nombre, proveedor_codigo, mes, destino_nombre, da.porcentaje
```

In `composicionOriginalesQuery`, find:
```sql
      SELECT DISTINCT
        COALESCE(cc.codigo, '__sin_concepto')                       AS concepto_codigo,
        p.id                                                          AS proveedor_id,
        COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')   AS proveedor_nombre,
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
    GROUP BY concepto_codigo, proveedor_id, proveedor_nombre, mes
```
Replace with:
```sql
      SELECT DISTINCT
        COALESCE(cc.codigo, '__sin_concepto')                       AS concepto_codigo,
        p.id                                                          AS proveedor_id,
        COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')   AS proveedor_nombre,
        c.codigo                                                     AS proveedor_codigo,
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
    GROUP BY concepto_codigo, proveedor_id, proveedor_nombre, proveedor_codigo, mes
```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass (this route has no dedicated test file — `SqlRow`/`ComposicionSqlRow`/`ComposicionOriginalRow` are structurally satisfied by the new SQL columns, verified by the pure-function tests from Tasks 3-4).

- [ ] **Step 4: Manual read-only verification against the real DB**

Run: `npx tsx --env-file=.env.local -e "import { prisma } from './lib/prisma'; prisma.\$queryRawUnsafe(\`SELECT c.codigo AS proveedor_codigo FROM v_compras_distribuidas c WHERE c.proveedor = 'Abril' LIMIT 5\`).then(r => { console.log(r); process.exit(0); })"`
Expected: rows with `proveedor_codigo` populated (368 or 670, matching the two real Abriles found during investigation).

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard/pivot/route.ts
git commit -m "feat(dashboard): la query del pivot trae proveedor_codigo para el árbol y el tooltip de composición"
```

---

### Task 6: Apertura rule matching — `lib/apertura/reevaluacion.ts`

**Files:**
- Modify: `lib/apertura/reevaluacion.ts:44-96`
- Test: `lib/apertura/reevaluacion.test.ts`

**Interfaces:**
- Consumes: `Compra.codigo` (already exists in the schema, now also needed in `reevaluarCompra`'s select).
- Produces: `resolverEntidadIdProveedor(compra: { proveedorId, proveedor, codigo })` returns `texto:<normalizado>|codigo:<codigo>` when `codigo` is not null, same as before otherwise.

- [ ] **Step 1: Write the failing tests**

In `lib/apertura/reevaluacion.test.ts`, the existing `resolverEntidadIdProveedor` tests call it with a 2-field object — once the signature requires `codigo`, TypeScript will error. Update them and add new cases:

```ts
describe("resolverEntidadIdProveedor", () => {
  it("proveedorId presente: usa el id numérico como string, sin importar el código", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: 5, proveedor: "Juan Perez", codigo: "999" })).toBe("5");
  });

  it("proveedorId null con texto crudo y codigo: usa 'texto:<normalizado>|codigo:<codigo>'", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Diego", codigo: "120" })).toBe("texto:diego|codigo:120");
  });

  it("proveedorId null con texto crudo pero SIN codigo: usa 'texto:<normalizado>' sin sufijo, igual que antes", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Diego", codigo: null })).toBe("texto:diego");
  });

  it("proveedorId null y sin texto: cae a 'texto:sinproveedor' (con codigo si lo hay)", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: null, codigo: null })).toBe("texto:sinproveedor");
  });

  it("dos personas con mismo nombre y codigo distinto resuelven a entidadId distinto", () => {
    const a = resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Abril", codigo: "368" });
    const b = resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Abril", codigo: "670" });
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/apertura/reevaluacion.test.ts`
Expected: FAIL — TypeScript error, `codigo` missing from the argument object.

- [ ] **Step 3: Implement**

In `lib/apertura/reevaluacion.ts`, find:
```ts
// Mismo criterio que condicionMatchNivel (lib/apertura/motor.ts) para nivel
// "proveedor" — extraída como función pura para poder testearla sin Prisma, y
// para que este archivo y el motor NUNCA puedan resolver un entidadId distinto
// para la misma compra.
export function resolverEntidadIdProveedor(compra: { proveedorId: number | null; proveedor: string | null }): string {
  if (compra.proveedorId != null) return String(compra.proveedorId);
  return `texto:${normalizarProveedorTexto(compra.proveedor)}`;
}
```
Replace with:
```ts
// Mismo criterio que condicionMatchNivel (lib/apertura/motor.ts) para nivel
// "proveedor" — extraída como función pura para poder testearla sin Prisma, y
// para que este archivo y el motor NUNCA puedan resolver un entidadId distinto
// para la misma compra. El sufijo `|codigo:<codigo>` desambigua personas
// reales distintas que comparten nombre (ver docs/superpowers/specs/
// 2026-09-28-codigo-empleado-proveedor-design.md §3.6) — se omite cuando la
// compra no trae código, para no fragmentar los casos que hoy funcionan bien.
export function resolverEntidadIdProveedor(compra: { proveedorId: number | null; proveedor: string | null; codigo: string | null }): string {
  if (compra.proveedorId != null) return String(compra.proveedorId);
  const base = `texto:${normalizarProveedorTexto(compra.proveedor)}`;
  return compra.codigo != null ? `${base}|codigo:${compra.codigo}` : base;
}
```

In the same file, find `reevaluarCompra`'s select (a few lines below):
```ts
  const compra = await prisma.compra.findUnique({
    where: { rowId },
    select: {
      localId: true, puntoDeVentaId: true,
      fecha: true, fechaManual: true,
      importe: true, importeManual: true,
      conceptoCodigo: true, conceptoCodigoManual: true,
      proveedorId: true, proveedor: true,
    },
  });
```
Replace with:
```ts
  const compra = await prisma.compra.findUnique({
    where: { rowId },
    select: {
      localId: true, puntoDeVentaId: true,
      fecha: true, fechaManual: true,
      importe: true, importeManual: true,
      conceptoCodigo: true, conceptoCodigoManual: true,
      proveedorId: true, proveedor: true, codigo: true,
    },
  });
```

`resolverEntidadIdProveedor(compra)` a few lines below (in `nivelesAProbar`) needs no change — `compra` now structurally has `codigo`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/apertura/reevaluacion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/reevaluacion.ts lib/apertura/reevaluacion.test.ts
git commit -m "fix(apertura): resolverEntidadIdProveedor suma el código de la compra para desambiguar personas con el mismo nombre"
```

---

### Task 7: Apertura rule matching — `lib/apertura/motor.ts`

**Files:**
- Modify: `lib/apertura/motor.ts:26-57`
- Test: `lib/apertura/motor.test.ts`

**Interfaces:**
- Consumes: `entidadId` strings in the new format from Task 6 / Task 3 (`texto:<normalizado>|codigo:<codigo>`).
- Produces: `condicionMatchNivel("proveedor", entidadId)` returns a `Prisma.Sql` with a second `AND c.codigo = ?` condition when `entidadId` carries the suffix.

- [ ] **Step 1: Write the failing tests**

In `lib/apertura/motor.test.ts`, add to the `condicionMatchNivel` describe block:

```ts
  it("nivel proveedor con entidadId 'texto:<normalizado>|codigo:<codigo>': agrega AND sobre c.codigo", () => {
    const cond = condicionMatchNivel("proveedor", "texto:abril|codigo:368");
    expect(cond.sql).toContain('"proveedorId" IS NULL');
    expect(cond.sql).toContain('"proveedorTextoNormalizado" = ?');
    expect(cond.sql).toContain('"codigo" = ?');
    expect(cond.values).toEqual(["abril", "368"]);
  });

  it("nivel proveedor con entidadId 'texto:<normalizado>' sin codigo: comportamiento sin cambios", () => {
    const cond = condicionMatchNivel("proveedor", "texto:diego");
    expect(cond.sql).not.toContain('"codigo" = ?');
    expect(cond.values).toEqual(["diego"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/apertura/motor.test.ts`
Expected: FAIL — the `texto:abril|codigo:368` case currently treats everything after `texto:` as the normalized value (`abril|codigo:368`), no second condition.

- [ ] **Step 3: Implement**

In `lib/apertura/motor.ts`, find:
```ts
    if (entidadId.startsWith("texto:")) {
      const valorNormalizado = entidadId.slice("texto:".length);
      // Paréntesis envolventes: los callers de hoy solo concatenan con AND, pero
      // uno futuro que use OR/NOT rompería la precedencia en silencio sobre plata
      // real (el IS NULL se ataría al OR externo en vez de al igual de texto).
      return Prisma.sql`(c."proveedorId" IS NULL AND c."proveedorTextoNormalizado" = ${valorNormalizado})`;
    }
```
Replace with:
```ts
    if (entidadId.startsWith("texto:")) {
      const resto = entidadId.slice("texto:".length);
      // "|codigo:" separa el nombre normalizado del código real de la compra —
      // dos personas con el mismo nombre pero código distinto (ej. dos "Abril")
      // no deben matchear la misma regla. Se compara contra la columna cruda
      // Compra.codigo (no un campo materializado) a propósito: evita tocar
      // proveedorTextoNormalizado, que ya está poblado para todo el histórico.
      // Ver docs/superpowers/specs/2026-09-28-codigo-empleado-proveedor-design.md §3.6.
      const separador = resto.indexOf("|codigo:");
      const valorNormalizado = separador === -1 ? resto : resto.slice(0, separador);
      const codigo = separador === -1 ? null : resto.slice(separador + "|codigo:".length);
      // Paréntesis envolventes: los callers de hoy solo concatenan con AND, pero
      // uno futuro que use OR/NOT rompería la precedencia en silencio sobre plata
      // real (el IS NULL se ataría al OR externo en vez de al igual de texto).
      return codigo !== null
        ? Prisma.sql`(c."proveedorId" IS NULL AND c."proveedorTextoNormalizado" = ${valorNormalizado} AND c."codigo" = ${codigo})`
        : Prisma.sql`(c."proveedorId" IS NULL AND c."proveedorTextoNormalizado" = ${valorNormalizado})`;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/apertura/motor.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/apertura/motor.ts lib/apertura/motor.test.ts
git commit -m "fix(apertura): condicionMatchNivel agrega el código de compra al matching de nivel proveedor"
```

---

### Task 8: UI — show "código - nombre" in the Compras x Proveedor view

**Files:**
- Modify: `lib/dashboard/constants.ts` (new constant)
- Modify: `components/dashboard/pivot-table-por-proveedor.tsx:1-10,249-269`

**Interfaces:**
- Consumes: `PivotProveedorSubRow.codigo`/`.rubroCodigo` (Task 3).
- Produces: the rendered proveedor-row label.

No new test file — this is a JSX rendering change in a codebase with no component-test infra (confirmed: no `.test.tsx` files exist anywhere in the repo). Verified via typecheck, build, lint, and a manual pass in the browser (see Step 5).

- [ ] **Step 1: Add the constant**

In `lib/dashboard/constants.ts`, find:
```ts
// Campo booleano de RubroConceptoCaja que controla si un rubro se ve en cada vista del dashboard.
```
Insert immediately before it:
```ts
// Rubro cuyos "proveedores" suelen ser en realidad personas de planilla con
// nombres ambiguos (ej. "Alejo" vs "Alejo Rodrigo", dos "Abril" con código
// distinto) — ahí se antepone el código de proveedor al nombre en la vista
// Compras x Proveedor. Ver docs/superpowers/specs/
// 2026-09-28-codigo-empleado-proveedor-design.md §2.3.
export const RUBRO_GASTOS_EN_PERSONAL_CODIGO = "3";

```

- [ ] **Step 2: Import the constant**

In `components/dashboard/pivot-table-por-proveedor.tsx`, find:
```ts
import { cn, fmtARS, normalize } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
```
Replace with:
```ts
import { cn, fmtARS, normalize } from "@/lib/utils";
import { MONTHS, RUBRO_GASTOS_EN_PERSONAL_CODIGO } from "@/lib/dashboard/constants";
```

- [ ] **Step 3: Render the prefix**

Find:
```tsx
              if (item.type === "proveedorSub") {
                const proveedor = item.data as PivotProveedorSubRow;
                const isExpanded = expanded.has(proveedor.id);
                const filtroProveedor = proveedor.proveedorId != null
                  ? { proveedorId: proveedor.proveedorId }
                  : proveedor.proveedorTexto != null
                    ? { proveedorTexto: proveedor.proveedorTexto }
                    : { sinProveedor: true as const };
                return (
                  <tr key={proveedor.id} className="border-b font-semibold" onContextMenu={collapseProveedores}>
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <div className="flex items-center gap-1">
                        <ExpandableButton
                          isExpanded={isExpanded}
                          onClick={() => toggleRow(proveedor.id)}
                          indent="pl-5"
                          iconSize="w-3.5 h-3.5"
                          className="flex-1 min-w-0"
                        >
                          {normalize(proveedor.nombre)}
                        </ExpandableButton>
```
Replace with:
```tsx
              if (item.type === "proveedorSub") {
                const proveedor = item.data as PivotProveedorSubRow;
                const isExpanded = expanded.has(proveedor.id);
                const filtroProveedor = proveedor.proveedorId != null
                  ? { proveedorId: proveedor.proveedorId }
                  : proveedor.proveedorTexto != null
                    ? { proveedorTexto: proveedor.proveedorTexto }
                    : { sinProveedor: true as const };
                // Bajo Gastos En Personal los "proveedores" suelen ser personas de
                // planilla con nombres ambiguos — el código del ERP los desambigua.
                // En el resto de rubros el nombre ya alcanza, así que no se antepone.
                const nombreProveedor =
                  proveedor.rubroCodigo === RUBRO_GASTOS_EN_PERSONAL_CODIGO && proveedor.codigo
                    ? `${proveedor.codigo} - ${normalize(proveedor.nombre)}`
                    : normalize(proveedor.nombre);
                return (
                  <tr key={proveedor.id} className="border-b font-semibold" onContextMenu={collapseProveedores}>
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <div className="flex items-center gap-1">
                        <ExpandableButton
                          isExpanded={isExpanded}
                          onClick={() => toggleRow(proveedor.id)}
                          indent="pl-5"
                          iconSize="w-3.5 h-3.5"
                          className="flex-1 min-w-0"
                        >
                          {nombreProveedor}
                        </ExpandableButton>
```

- [ ] **Step 4: Typecheck, lint, full test suite, build**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: all clean.

- [ ] **Step 5: Manual browser verification**

Run: `npm run dev`, open the dashboard, switch to Compras → Proveedor, pick a local/PDV/period with data under "Gastos En Personal" (e.g. Ramos Mejía, 2026, a month with payroll rows). Confirm:
- Rows under "Gastos En Personal" now show `"<código> - <nombre>"`.
- Rows under any other rubro (e.g. compras a un proveedor comercial real) show the plain name, unchanged.
- "Abril" (if present in the period shown) now appears as two separate rows with different codes, not merged into one.
- Click into a row's detail modal — still opens correctly (unaffected by this change, `filtroProveedor` logic untouched).

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/constants.ts components/dashboard/pivot-table-por-proveedor.tsx
git commit -m "feat(dashboard): muestra código de proveedor delante del nombre en Gastos En Personal"
```

---

## Self-Review Notes

- **Spec coverage:** §2.1 (formato) → Task 8. §2.2 (alcance) → Task 8 only touches this one render site, confirmed no other consumer of `PivotProveedorSubRow.nombre` was changed. §2.3 (rubro 3 only) → Task 8's conditional. §2.4 (fuente Compra.codigo) → Task 1/5. §2.5 (agrupado parejo en todos los rubros) → Task 3's key change has no rubro guard, applies everywhere. §2.6 (reglas de Apertura) → out of scope for THIS plan, covered by the separate rules-migration plan (see below) which depends on Tasks 1-7 being deployed first. §2.7 (sin código, sin sufijo) → covered by the `proveedor_codigo != null` branches in Tasks 3, 4, 6, 7.
- **Placeholder scan:** none found — every step has concrete code.
- **Type consistency:** `proveedor_codigo`/`codigo`/`rubroCodigo` names are consistent from `SqlRow` (Task 2) through the builder (Task 3), composition (Task 4), SQL (Task 5), and UI (Task 8). `resolverEntidadIdProveedor`'s new `codigo` parameter (Task 6) and `condicionMatchNivel`'s parsing (Task 7) both produce/consume the identical `texto:<normalizado>|codigo:<codigo>` string format — verified against each other's test cases (`texto:abril|codigo:368` appears in both Task 3's and Task 6's and Task 7's tests).
- **Correction to the spec:** spec §6 ("Fuera de alcance") claimed `apertura-composicion.ts` "hereda el nuevo formato automáticamente" — that's incorrect, it computes its own key independently (confirmed by reading the code during planning). Task 4 fixes this explicitly; the spec's §6 claim should be considered superseded by this plan.

## Separate plan required: Apertura rule migration

This plan does **not** include migrating the 24 safe `reglas_apertura` or dissolving/redistributing the 8 ambiguous ones (spec §4) — that's a data migration against production financial data, needs its own dry-run/backup/apply/verify script (same pattern as `scripts/fix-proveedorid-cruzado.ts`), and must run strictly **after** Tasks 1-8 here are deployed (the old code doesn't understand the new `entidadId` format, so a migrated rule would match nothing until deploy). Write that as its own plan once this one is implemented and live.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-28-codigo-empleado-proveedor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
