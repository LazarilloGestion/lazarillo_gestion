# Identidad de líneas de detalle_compras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **CLAUDE.md §9.1: subagent-driven-development NO puede ejecutar la Task 5 (toca datos importados): esa la corre el agente en conversación, con el usuario presente y con su OK explícito.**

**Goal:** Que `detalle_compras` no pierda líneas repetidas ni pise líneas de otros proveedores o locales, y reimportar la historia con la identidad nueva.

**Architecture:** El `rowId` de cada línea pasa a incluir local, proveedor y un índice de ocurrencia dentro del archivo (función pura nueva `detalleCompraRowIds`). El vínculo a compras exige el mismo proveedor. Un script con dry-run reimporta todos los archivos de detalle guardados en el bucket: primero inserta y después borra las filas viejas.

**Tech Stack:** TypeScript, Prisma 7 ($executeRaw), Supabase Storage (bucket `uploads`), xlsx, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-10-14-identidad-lineas-detalle-compras-design.md`

## Global Constraints

- Toda validación de datos externos con zod `safeParse` (ya lo hace `detalleCompraRowSchema`). No se agregan dependencias.
- Ningún error de import o parseo puede fallar en silencio (CLAUDE.md §2).
- TDD obligatorio en la capa ETL (CLAUDE.md §9.1).
- El script es dry-run por defecto; `--apply` solo con OK explícito del usuario después de ver el dry-run.
- Orden de la reimportación: insertar → borrar, nunca al revés.
- **El código de las Tasks 1–3 no se mergea a `main` hasta correr la Task 5.** Si se deployara antes, el próximo import de Drive insertaría líneas con `rowId` nuevo al lado de las viejas y el modal las mostraría duplicadas.
- Conventional Commits, con el trailer de atribución de la sesión.

---

### Task 1: Identidad nueva de la línea

**Files:**
- Modify: `lib/etl/normalizers/detalle-compras.ts` (reemplazar `makeRowId` y la dedup por rowId; exportar `makeComprobante`)
- Test: `lib/etl/normalizers/detalle-compras.test.ts`

**Interfaces:**
- Produces: `export function detalleCompraRowIds(rows: ETLRow[], localId: number | null): string[]` (un id por fila, mismo orden) y `export function makeComprobante(r: ETLRow): string | null` (sin cambios de comportamiento, solo pasa a exportarse).

- [ ] **Step 1: Escribir los tests que fallan**

Reemplazar el test `"dos filas con hash idéntico (duplicado real)..."` por:

```ts
  it("dos líneas idénticas en la misma factura se guardan las dos (el ERP no exporta número de línea)", async () => {
    const db = createMockDb();
    const res = await normalizeDetalleCompras([baseRow(), baseRow()], db, { localId: 1 });
    expect(res.created).toBe(2);
    expect(res.skippedRows).toHaveLength(0);
  });
```

Agregar al final del archivo:

```ts
describe("detalleCompraRowIds", () => {
  it("líneas idénticas en la misma factura reciben ids distintos", () => {
    const [a, b] = detalleCompraRowIds([baseRow(), baseRow()], 1);
    expect(a).not.toBe(b);
  });

  it("la misma línea en tickets de dos proveedores con el mismo número recibe ids distintos", () => {
    const [a, b] = detalleCompraRowIds([baseRow({ COD_PRO: "194" }), baseRow({ COD_PRO: "256" })], 1);
    expect(a).not.toBe(b);
  });

  it("la misma línea en dos locales recibe ids distintos", () => {
    const [a] = detalleCompraRowIds([baseRow()], 1);
    const [b] = detalleCompraRowIds([baseRow()], 2);
    expect(a).not.toBe(b);
  });

  it("es estable entre reimportaciones del mismo archivo", () => {
    const filas = [baseRow(), baseRow({ CODIGO: "ART2" }), baseRow()];
    expect(detalleCompraRowIds(filas, 1)).toEqual(detalleCompraRowIds(filas, 1));
  });

  it("si cambia el orden de las líneas idénticas, el conjunto de ids es el mismo", () => {
    const otra = baseRow({ CODIGO: "ART2" });
    const ids1 = detalleCompraRowIds([baseRow(), otra, baseRow()], 1);
    const ids2 = detalleCompraRowIds([otra, baseRow(), baseRow()], 1);
    expect(new Set(ids1)).toEqual(new Set(ids2));
  });

  it("localId null no rompe y es distinto de un local asignado", () => {
    const [a] = detalleCompraRowIds([baseRow()], null);
    const [b] = detalleCompraRowIds([baseRow()], 1);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });
});
```

Y cambiar el import de la primera línea a:

```ts
import { normalizeDetalleCompras, detalleCompraRowIds } from "./detalle-compras";
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/etl/normalizers/detalle-compras.test.ts`
Expected: FAIL — `detalleCompraRowIds is not a function`, y el test de líneas idénticas falla con `created` = 1.

- [ ] **Step 3: Implementar**

En `lib/etl/normalizers/detalle-compras.ts`:

1. Cambiar `function makeComprobante` por `export function makeComprobante` (mismo cuerpo).
2. Reemplazar `makeRowId` (comentario incluido) por:

```ts
// Identidad de una línea. El ERP no exporta número de línea, así que dos líneas
// iguales de una misma factura (mismo artículo, cantidad y precio) solo se
// distinguen por su orden de aparición: `ocurrencia` es el índice de esa misma
// tupla dentro del archivo. Como esas líneas son intercambiables, el conjunto
// de ids no cambia aunque el ERP las reordene. COD_PRO y localId van en la
// clave porque el mismo número de ticket se repite entre proveedores (y puede
// repetirse entre locales): sin ellos una línea pisaba a otra — ver spec
// 2026-10-14-identidad-lineas-detalle-compras-design.md.
export function detalleCompraRowIds(rows: ETLRow[], localId: number | null): string[] {
  const vistas = new Map<string, number>();
  return rows.map((r) => {
    const base = [localId, r["COD_PRO"], r["COD_CPB"], r["NUMERO1"], r["NUMERO2"], r["CODIGO"], r["CANTIDAD"], r["NETO"]]
      .map((v) => String(v ?? ""))
      .join("|");
    const ocurrencia = vistas.get(base) ?? 0;
    vistas.set(base, ocurrencia + 1);
    return createHash("sha256").update(`${base}|${ocurrencia}`).digest("hex").substring(0, 24);
  });
}
```

3. En `normalizeDetalleCompras`, antes de `rows.forEach(...)`:

```ts
  const rowIds = detalleCompraRowIds(rows, ctx?.localId ?? null);
```

y dentro del `forEach`, cambiar `parsedRows.push({ rowId: makeRowId(r), row: r, data: parsed.data, idx });` por:

```ts
    parsedRows.push({ rowId: rowIds[idx], row: r, data: parsed.data, idx });
```

4. Borrar el bloque de dedup completo, desde el comentario `// Dedup por rowId — last-wins...` hasta `const filtered = Array.from(rowIdMap.values());`, y reemplazarlo por:

```ts
  // Con la ocurrencia en la clave no hay dos filas del archivo con el mismo
  // rowId, así que no hay dedup: cada línea del ERP se guarda.
  const filtered = parsedRows;
```

(`const skipped = skippedRows.length;` queda igual.)

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run lib/etl/normalizers/detalle-compras.test.ts`
Expected: PASS (todos, incluidos los existentes: el de sanity check de buckets sigue cerrando).

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/detalle-compras.ts lib/etl/normalizers/detalle-compras.test.ts
git commit -m "fix(etl): identidad de línea de detalle con proveedor, local y ocurrencia"
```

---

### Task 2: El vínculo a compras exige el mismo proveedor

**Files:**
- Modify: `lib/etl/normalizer-utils.ts:19-29`
- Test: `lib/etl/normalizer-utils.test.ts`

**Interfaces:**
- Consumes: nada nuevo. `linkDetalleComprasByComprobante(prisma: DbClient, localId: number): Promise<void>` mantiene la firma.

- [ ] **Step 1: Escribir el test que falla**

Dentro de `describe("linkDetalleComprasByComprobante", ...)`:

```ts
  it("solo vincula con una compra del mismo proveedor (el número de ticket se repite entre proveedores)", async () => {
    const db = createMockDb();
    await linkDetalleComprasByComprobante(db, 7);
    const sql = ((db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(/dc\."codPro"\s*=\s*c\.codigo/);
  });
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/etl/normalizer-utils.test.ts`
Expected: FAIL en el test nuevo (no matchea `dc."codPro" = c.codigo`).

- [ ] **Step 3: Implementar**

En el `UPDATE` de `linkDetalleComprasByComprobante`, agregar después de `WHERE dc.comprobante = c.comprobante`:

```sql
      AND dc."codPro" = c.codigo
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/etl/normalizer-utils.test.ts`
Expected: PASS (el test existente de `[42, 42]` sigue pasando: no se agregan parámetros).

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizer-utils.ts lib/etl/normalizer-utils.test.ts
git commit -m "fix(etl): detalle_compras se vincula solo a compras del mismo proveedor"
```

---

### Task 3: Script de reimportación con dry-run

**Files:**
- Create: `scripts/reimportar-detalle-compras.ts`
- Test: `scripts/reimportar-detalle-compras.test.ts`

**Interfaces:**
- Consumes: `detalleCompraRowIds`, `makeComprobante`, `normalizeDetalleCompras` (Task 1); `linkDetalleCompras` (`lib/etl/link-detalle-compras.ts`); `readExcelBuffer`, `trim` (`lib/etl/helpers.ts`); `getSupabaseAdmin` (`lib/supabase/admin.ts`); `getEtlClient` (`lib/etl/etl-client.ts`).
- Produces: `export function planReimportacion(existentes: LineaRef[], nuevas: LineaRef[]): PlanReimportacion` y los tipos `LineaRef = { rowId: string; comprobante: string | null }`, `PlanReimportacion = { aInsertar: number; aBorrar: string[]; aBorrarSinArchivo: string[] }`.

- [ ] **Step 1: Escribir los tests que fallan**

`scripts/reimportar-detalle-compras.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planReimportacion } from "./reimportar-detalle-compras";

const l = (rowId: string, comprobante: string | null = "Z000100000001") => ({ rowId, comprobante });

describe("planReimportacion", () => {
  it("sin cambios de identidad no inserta ni borra", () => {
    expect(planReimportacion([l("a"), l("b")], [l("a"), l("b")])).toEqual({ aInsertar: 0, aBorrar: [], aBorrarSinArchivo: [] });
  });

  it("ids nuevos se insertan y los viejos que ya no aparecen se borran", () => {
    expect(planReimportacion([l("viejo")], [l("nuevo1"), l("nuevo2")])).toEqual({
      aInsertar: 2,
      aBorrar: ["viejo"],
      aBorrarSinArchivo: [],
    });
  });

  it("marca como sin archivo las filas a borrar cuyo comprobante no está en ningún archivo reimportado", () => {
    const plan = planReimportacion([l("viejo", "Z000100000001"), l("huerfano", "A000500000009")], [l("nuevo", "Z000100000001")]);
    expect(plan.aBorrar).toEqual(["viejo", "huerfano"]);
    expect(plan.aBorrarSinArchivo).toEqual(["huerfano"]);
  });

  it("una fila a borrar sin comprobante cuenta como sin archivo", () => {
    expect(planReimportacion([l("x", null)], [l("y")]).aBorrarSinArchivo).toEqual(["x"]);
  });

  it("ids repetidos entre archivos del mismo local (Bar y Canchas traen la misma factura) cuentan una vez", () => {
    expect(planReimportacion([], [l("a"), l("a")]).aInsertar).toBe(1);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run scripts/reimportar-detalle-compras.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar**

`scripts/reimportar-detalle-compras.ts`:

```ts
/**
 * reimportar-detalle-compras.ts
 *
 * Reimporta todo detalle_compras con la identidad de línea nueva (spec
 * 2026-10-14-identidad-lineas-detalle-compras-design.md): la vieja perdía
 * líneas repetidas de una factura y pisaba líneas entre proveedores con el
 * mismo número de ticket.
 *
 * Por cada local toma el último archivo de detalle importado OK de cada
 * nombre (import_logs + bucket `uploads`), inserta las líneas con el rowId
 * nuevo y DESPUÉS borra las filas del local que no salieron de esos archivos.
 * Insertar primero: si se corta a mitad, la tabla nunca queda vacía; volver a
 * correrlo termina el trabajo (es idempotente).
 *
 * Dry-run por defecto: baja los archivos, calcula los ids y reporta qué haría
 * sin escribir. --apply aborta si alguna fila a borrar no tiene archivo que la
 * reemplace, o si el import de algún archivo devuelve errores.
 *
 * Uso:
 *   npx tsx scripts/reimportar-detalle-compras.ts            # dry-run
 *   npx tsx scripts/reimportar-detalle-compras.ts --apply     # aplica
 */

import { fileURLToPath } from "url";
import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";
config({ path: ".env.local" });

import { Prisma } from "@prisma/client";
import { getEtlClient } from "../lib/etl/etl-client";
import { getSupabaseAdmin } from "../lib/supabase/admin";
import { readExcelBuffer, trim } from "../lib/etl/helpers";
import { detalleCompraRowIds, makeComprobante, normalizeDetalleCompras } from "../lib/etl/normalizers/detalle-compras";
import { linkDetalleCompras } from "../lib/etl/link-detalle-compras";
import type { DbClient, ETLRow } from "../lib/etl/types";

const RESPALDO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "reimportar-detalle-compras");

export interface LineaRef {
  rowId: string;
  comprobante: string | null;
}

export interface PlanReimportacion {
  aInsertar: number;
  aBorrar: string[];
  aBorrarSinArchivo: string[];
}

export function planReimportacion(existentes: LineaRef[], nuevas: LineaRef[]): PlanReimportacion {
  const idsNuevos = new Set(nuevas.map((n) => n.rowId));
  const idsExistentes = new Set(existentes.map((e) => e.rowId));
  const comprobantesNuevos = new Set(nuevas.map((n) => n.comprobante).filter((c): c is string => c != null));
  const aBorrarFilas = existentes.filter((e) => !idsNuevos.has(e.rowId));
  return {
    aInsertar: [...idsNuevos].filter((id) => !idsExistentes.has(id)).length,
    aBorrar: aBorrarFilas.map((e) => e.rowId),
    aBorrarSinArchivo: aBorrarFilas
      .filter((e) => e.comprobante == null || !comprobantesNuevos.has(e.comprobante))
      .map((e) => e.rowId),
  };
}

interface ArchivoDetalle {
  localId: number;
  puntoDeVentaId: number | null;
  fileName: string;
  storagePath: string;
}

async function listarArchivos(db: DbClient): Promise<ArchivoDetalle[]> {
  return db.$queryRaw<ArchivoDetalle[]>(Prisma.sql`
    SELECT DISTINCT ON ("localId", "puntoDeVentaId", "fileName")
      "localId", "puntoDeVentaId", "fileName", "storagePath"
    FROM import_logs
    WHERE "fileType" = 'detalleCompras' AND estado = 'ok'
      AND "storagePath" IS NOT NULL AND "localId" IS NOT NULL
    ORDER BY "localId", "puntoDeVentaId", "fileName", "creadoEn" DESC
  `);
}

async function bajar(storagePath: string): Promise<Buffer> {
  const { data, error } = await getSupabaseAdmin().storage.from("uploads").download(storagePath);
  if (error) throw new Error(`No se pudo bajar ${storagePath}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

// Mismo filtro que normalizeDetalleCompras para "sin_datos": esas filas nunca se insertan.
function lineasNuevas(rows: ETLRow[], localId: number): LineaRef[] {
  const ids = detalleCompraRowIds(rows, localId);
  return rows
    .map((r, i) => ({ r, rowId: ids[i] }))
    .filter(({ r }) => trim(r["COD_CPB"]) != null && trim(r["CODIGO"]) != null)
    .map(({ r, rowId }) => ({ rowId, comprobante: makeComprobante(r) }));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getEtlClient() as unknown as DbClient;
  const prisma = getEtlClient();

  const sinLocal = await prisma.detalleCompra.count({ where: { localId: null } });
  if (sinLocal > 0) throw new Error(`Hay ${sinLocal} líneas sin localId: revisar a mano antes de reimportar.`);

  const archivos = await listarArchivos(db);
  const locales = [...new Set(archivos.map((a) => a.localId))];
  const sello = new Date().toISOString().replace(/[:.]/g, "-");

  for (const localId of locales) {
    const delLocal = archivos.filter((a) => a.localId === localId);
    const filasPorArchivo = new Map<ArchivoDetalle, ETLRow[]>();
    for (const a of delLocal) filasPorArchivo.set(a, readExcelBuffer(await bajar(a.storagePath)));

    const nuevas = [...filasPorArchivo.values()].flatMap((rows) => lineasNuevas(rows, localId));
    const existentes = await prisma.detalleCompra.findMany({ where: { localId }, select: { rowId: true, comprobante: true } });
    const plan = planReimportacion(existentes, nuevas);

    console.log(`\nLocal ${localId}: ${delLocal.length} archivos, ${existentes.length} líneas hoy, ${new Set(nuevas.map((n) => n.rowId)).size} líneas en los archivos.`);
    console.log(`  a insertar: ${plan.aInsertar} · a borrar: ${plan.aBorrar.length} · a borrar sin archivo que las reemplace: ${plan.aBorrarSinArchivo.length}`);

    if (!apply) continue;
    if (plan.aBorrarSinArchivo.length > 0) {
      throw new Error(`Local ${localId}: ${plan.aBorrarSinArchivo.length} líneas se borrarían sin archivo que las reemplace. No se escribió nada en este local.`);
    }

    for (const [a, rows] of filasPorArchivo) {
      const res = await normalizeDetalleCompras(rows, db, { localId, puntoDeVentaId: a.puntoDeVentaId ?? undefined });
      console.log(`  ${a.fileName}: ${res.created} creadas, ${res.updated} actualizadas, ${res.skipped} omitidas, ${res.errors.length} errores`);
      if (res.errors.length > 0) {
        throw new Error(`Errores al importar ${a.fileName}: ${JSON.stringify(res.errors.slice(0, 5))}. Se insertó lo anterior pero no se borró nada de este local.`);
      }
    }

    // Recalculo en vivo: la base pudo cambiar entre el plan y el apply.
    const vivas = await prisma.detalleCompra.findMany({ where: { localId }, select: { rowId: true, comprobante: true } });
    const planVivo = planReimportacion(vivas, nuevas);
    if (planVivo.aBorrarSinArchivo.length > 0) {
      throw new Error(`Local ${localId}: el recálculo en vivo encontró ${planVivo.aBorrarSinArchivo.length} líneas sin archivo. No se borró nada.`);
    }

    fs.mkdirSync(RESPALDO_DIR, { recursive: true });
    const respaldo = path.join(RESPALDO_DIR, `local-${localId}-${sello}.json`);
    const filasABorrar = await prisma.detalleCompra.findMany({ where: { rowId: { in: planVivo.aBorrar } } });
    fs.writeFileSync(respaldo, JSON.stringify(filasABorrar));
    console.log(`  respaldo de las ${filasABorrar.length} filas a borrar: ${respaldo}`);

    const borradas = await prisma.$transaction(
      (tx) => tx.$executeRaw(Prisma.sql`DELETE FROM detalle_compras WHERE "localId" = ${localId} AND "rowId" = ANY(${planVivo.aBorrar}::text[])`),
      { timeout: 55000 }
    );
    if (borradas !== planVivo.aBorrar.length) {
      throw new Error(`Local ${localId}: se borraron ${borradas} filas y se esperaban ${planVivo.aBorrar.length}.`);
    }
    await linkDetalleCompras(db, localId);
    console.log(`  borradas ${borradas} filas viejas y re-vinculadas las líneas a sus compras.`);
  }

  if (!apply) console.log("\nDry-run: no se escribió nada. Volvé a correr con --apply para aplicar.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => getEtlClient().$disconnect());
}
```

Nota para el implementador: el `$transaction` del DELETE recibe un callback; `tx.$executeRaw` devuelve la cantidad de filas borradas. Hay un solo statement, pero se deja en transacción para que, si falla, no quede a medias. Antes del `linkDetalleCompras`, las filas nuevas tienen `compraId` null porque el INSERT del normalizer no lo setea: el link las vincula a todas.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run scripts/reimportar-detalle-compras.test.ts && npx tsc --noEmit -p . && npm run lint`
Expected: PASS, sin errores de tipos ni de lint.

- [ ] **Step 5: Commit**

```bash
git add scripts/reimportar-detalle-compras.ts scripts/reimportar-detalle-compras.test.ts
git commit -m "feat(scripts): reimportación de detalle_compras con la identidad nueva"
```

---

### Task 4: Dry-run contra producción (solo lectura)

**Files:** ninguno.

- [ ] **Step 1: Medición "antes" (solo lectura)**

```bash
URL=$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"')
psql "$URL" -c "set default_transaction_read_only=on;" -c "
with d as (select comprobante, \"localId\", \"codPro\" prov, sum(coalesce(\"totalIns\",0)+coalesce(\"ivaTot\",0)+coalesce(\"impNtTot\",0)) tot from detalle_compras where comprobante is not null group by 1,2,3),
c as (select comprobante, \"localId\", codigo prov, sum(coalesce(importe,0)) imp from compras where comprobante is not null group by 1,2,3)
select (select count(*) from detalle_compras) lineas, count(*) filter (where abs(imp-tot)>=1) no_cuadran from d join c using (comprobante,\"localId\",prov);"
```

Expected: `no_cuadran` = 222 (valor del 14-oct; puede variar un poco si hubo imports nuevos). Anotar `lineas`.

- [ ] **Step 2: Correr el dry-run**

Run: `npx tsx scripts/reimportar-detalle-compras.ts`
Expected: por cada local, "a borrar sin archivo" = 0 y "a insertar" > "a borrar" (se recuperan líneas). Si "sin archivo" > 0, **parar**: reportar al usuario los comprobantes y no seguir.

- [ ] **Step 3: Reportar al usuario y pedir OK para la Task 5**

Mostrar los números del dry-run por local. No seguir sin un "sí" explícito.

---

### Task 5: Aplicar, deployar y verificar (requiere OK del usuario)

**Files:** ninguno nuevo.

- [ ] **Step 1: Confirmar que no hay un import de Drive corriendo** (preguntar al usuario).

- [ ] **Step 2: Aplicar**

Run: `npx tsx scripts/reimportar-detalle-compras.ts --apply`
Expected: por local, archivos importados sin errores, "borradas N filas viejas" con N = "a borrar" del dry-run (±imports intermedios). Ante cualquier excepción: parar y avisar. Volver a correrlo es seguro.

- [ ] **Step 3: Mergear, pushear y esperar el deploy**

```bash
git checkout main && git pull --ff-only && git merge --no-ff fix/identidad-lineas-detalle-compras -m "Merge branch 'fix/identidad-lineas-detalle-compras'"
git push origin main && git branch -d fix/identidad-lineas-detalle-compras
```

Pedir al usuario que confirme que el deploy de Vercel quedó en *Ready*.

- [ ] **Step 4: Verificación post (solo lectura)**

Repetir la query del Step 1 de la Task 4. Expected: `no_cuadran` cerca de 96, más un residuo chico; `lineas` ≥ el valor de antes.

```bash
psql "$URL" -c "set default_transaction_read_only=on;" -c "
select comprobante, \"codPro\", count(*), round(sum(coalesce(\"totalIns\",0)+coalesce(\"ivaTot\",0)+coalesce(\"impNtTot\",0)),2) tot
from detalle_compras where (comprobante='Z093518022022' and \"codPro\"='201') or (comprobante='Z000100000001' and \"codPro\"='194' and \"localId\"=1) group by 1,2;"
```

Expected: Z093518022022/201 → 10 líneas, $27.400. Z000100000001/194 → 4 líneas, $3.800.

- [ ] **Step 5: Dry-run de control después del deploy**

Run: `npx tsx scripts/reimportar-detalle-compras.ts`
Expected: a insertar 0, a borrar 0 en todos los locales.

- [ ] **Step 6: Actualizar memoria** (`project_detalle_compras_rowid_colisiones.md`): aplicado, números antes/después.
