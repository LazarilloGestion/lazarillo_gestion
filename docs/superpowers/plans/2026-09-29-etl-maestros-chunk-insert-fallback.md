# ETL: Fallback Fila-por-Fila en Normalizers de Maestros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a los 6 normalizers de datos maestro (`articulos`, `proveedores`, `rubros-articulo`, `subrubros-articulo`, `conceptos-caja`, `rubros-concepto-caja`) el mismo fix que el plan `2026-09-28-etl-chunk-insert-fallback.md` ya aplicó a `compras`/`ventas`/`detalle-compras`: cuando el INSERT en lote falla por una sola fila corrupta, aislar esa fila y persistir el resto en vez de descartar en silencio todo el chunk.

**Architecture:** Reutiliza el helper `insertChunkWithRowFallback` (`lib/etl/chunked-upsert.ts`, ya en `main`) sin modificarlo. Los 6 normalizers de maestros comparten una estructura idéntica entre sí (más simple que compras/ventas: dedup directo por `CODIGO` en un `Map`, sin wrapper `rowId`/`row`), así que el cambio es mecánico y uniforme en los 6 archivos. Se aprovecha además un hallazgo del review final del plan anterior: `rowIndex` debe reportar la posición real de la fila (`idx` capturado en el `forEach` de parseo), no el offset del chunk — este plan lo aplica desde el arranque en vez de necesitar una ronda de fix aparte.

**Tech Stack:** TypeScript, Prisma (`$executeRaw` + `Prisma.sql`), Vitest.

**Spec:** No hay doc de spec separado — mismo criterio que el plan anterior: el contrato de comportamiento surge de CLAUDE.md §2 ("ningún error de import/parseo puede fallar en silencio") y de la extensión directa del patrón ya revisado y mergeado en `lib/etl/normalizers/compras.ts`/`ventas.ts`/`detalle-compras.ts`.

## Global Constraints

- CLAUDE.md §2: ningún error de import/parseo de datos financieros puede fallar en silencio — toda fila que no se persista debe terminar en `errors` con un mensaje específico de esa fila, con el `rowIndex` real de esa fila (no el offset del chunk).
- No agregar dependencias nuevas. No modificar `lib/etl/chunked-upsert.ts` — se consume tal cual quedó en `main`.
- No modificar código fuera del alcance de este plan (no tocar `compras.ts`/`ventas.ts`/`detalle-compras.ts`, ya migrados).
- Correr `npm test` y `npm run lint` al final de cada tarea.
- Este plan solo cambia código y tests — no ejecuta nada contra la base de producción.

---

### Task 1: Aplicar el fallback a `normalizeArticulos`

**Files:**
- Modify: `lib/etl/normalizers/articulos.ts` (import, tipo de dedup, loop de inserción)
- Modify: `lib/etl/normalizers/articulos.test.ts:59-66` (ajustar test existente) y agregar un test nuevo

**Interfaces:**
- Consumes: `insertChunkWithRowFallback` (`lib/etl/chunked-upsert.ts`, ya en `main`)

- [ ] **Step 1: Escribir el test que falla + ajustar el test existente**

En `lib/etl/normalizers/articulos.test.ts`, reemplazar el test existente (líneas 59-66):

```ts
  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeArticulos([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });
```

(único cambio: `mockRejectedValueOnce` → `mockRejectedValue` — con el fallback, una fila genuinamente inválida se reintenta y debe seguir fallando en el reintento, no solo en el primer intento).

Agregar inmediatamente después un test nuevo:

```ts
  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 8) throw new Error("simulated batch failure");
      if (sql.values[0] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeArticulos(
      [baseRow({ CODIGO: "BAD" }), baseRow({ CODIGO: "OK" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    expect(res.errors[0].rowIndex).toBe(0);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el nuevo falla**

Run: `npx vitest run lib/etl/normalizers/articulos.test.ts`
Expected: el test nuevo FALLA con `res.created` = 0 (el código actual descarta las 2 filas del chunk cuando el INSERT de lote rechaza, no aísla la fila mala). El resto de los tests existentes debería seguir en PASS.

- [ ] **Step 3: Aplicar el fallback en la implementación**

Reemplazar el contenido completo de `lib/etl/normalizers/articulos.ts` por:

```ts
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { articuloRowSchema, type ArticuloRow } from "../schemas/articulos";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

const CHUNK_SIZE = 500;

export async function normalizeArticulos(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  // Dedup por CODIGO (last-wins) intencional para maestros.
  const parsedByCodigo = new Map<string, { data: ArticuloRow; idx: number }>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = articuloRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, { data: parsed.data, idx });
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.data.CODIGO);
  const existingSet = new Set(
    (await prisma.articulo.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const values = rowsToInsert.map(({ data }) => {
          const codRua = data.COD_RUA != null && data.COD_RUA > 0 ? String(data.COD_RUA) : null;
          const codSua = data.COD_SUA != null && data.COD_SUA > 0 ? String(data.COD_SUA) : null;
          return Prisma.sql`(
            ${data.CODIGO},
            ${data.NOMBRE ?? "(sin nombre)"},
            ${data.PRECIO1}::numeric,
            ${data.PRECIO2}::numeric,
            ${data.PRECIO3}::numeric,
            ${data.PRECIO4}::numeric,
            ${codRua},
            ${codSua}
          )`;
        });

        return Prisma.sql`
          INSERT INTO articulos (codigo, nombre, precio1, precio2, precio3, precio4, "codRua", "codSua")
          VALUES ${Prisma.join(values)}
          ON CONFLICT (codigo) DO UPDATE SET
            nombre   = EXCLUDED.nombre,
            precio1  = EXCLUDED.precio1,
            precio2  = EXCLUDED.precio2,
            precio3  = EXCLUDED.precio3,
            precio4  = EXCLUDED.precio4,
            "codRua" = EXCLUDED."codRua",
            "codSua" = EXCLUDED."codSua"
        `;
      },
      ({ data, idx }, err) => ({
        rowIndex: idx,
        rawCodigo: data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { data } of insertedRows) {
          if (existingSet.has(data.CODIGO)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }

  return { created, updated, skipped, errors };
}
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/articulos.test.ts`
Expected: PASS (todos los tests, incluido el nuevo)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/articulos.ts lib/etl/normalizers/articulos.test.ts
git commit -m "fix(etl): articulos aísla la fila corrupta de un lote en vez de perder todo el chunk"
```

---

### Task 2: Aplicar el fallback a `normalizeProveedores`

**Files:**
- Modify: `lib/etl/normalizers/proveedores.ts`
- Modify: `lib/etl/normalizers/proveedores.test.ts:70-77` (ajustar test existente) y agregar un test nuevo

**Interfaces:**
- Consumes: `insertChunkWithRowFallback`

- [ ] **Step 1: Escribir el test que falla + ajustar el test existente**

En `lib/etl/normalizers/proveedores.test.ts`, reemplazar el test existente (líneas 70-77):

```ts
  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeProveedores([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });
```

Agregar inmediatamente después un test nuevo:

```ts
  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 19) throw new Error("simulated batch failure");
      if (sql.values[0] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeProveedores(
      [baseRow({ CODIGO: "BAD" }), baseRow({ CODIGO: "OK" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    expect(res.errors[0].rowIndex).toBe(0);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el nuevo falla**

Run: `npx vitest run lib/etl/normalizers/proveedores.test.ts`
Expected: el test nuevo FALLA con `res.created` = 0. El resto sigue en PASS.

- [ ] **Step 3: Aplicar el fallback en la implementación**

Reemplazar el contenido completo de `lib/etl/normalizers/proveedores.ts` por:

```ts
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { proveedorRowSchema, type ProveedorRow } from "../schemas/proveedores";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

const CHUNK_SIZE = 500;

export async function normalizeProveedores(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  // Dedup por CODIGO (last-wins) es intencional para maestros: una fila con el
  // mismo código en el mismo export es la misma entidad real, no una colisión
  // de hash entre dos entidades distintas (a diferencia de compras/ventas).
  const parsedByCodigo = new Map<string, { data: ProveedorRow; idx: number }>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = proveedorRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, { data: parsed.data, idx });
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.data.CODIGO);
  const existingSet = new Set(
    (await prisma.proveedor.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const values = rowsToInsert.map(({ data }) => {
          return Prisma.sql`(
            ${data.CODIGO},
            ${data.NOMBRE},
            ${data.RAZON},
            ${data.DIRECCION},
            ${data.LOCALIDAD},
            ${data.CONTACTO},
            ${data.TELEFONO},
            ${data.FAX},
            ${data.CELULAR},
            ${data.TIPO_IVA},
            ${data.CUIT},
            ${data.CBU},
            ${data.ALIASCBU},
            ${data.DIAS_VENC},
            ${data.IVA != null ? (data.IVA ? 1 : 0) : null},
            ${data.IVA_DIF != null ? (data.IVA_DIF ? 1 : 0) : null},
            ${data.E_MAIL},
            ${data.OBSERVAC},
            ${data.DETPERC}
          )`;
        });

        return Prisma.sql`
          INSERT INTO proveedores (
            codigo, nombre, razon, direccion, localidad, contacto,
            telefono, fax, celular, "tipoIva", cuit, cbu, "aliasCbu",
            "diasVenc", iva, "ivaDif", email, observac, "detPerc"
          )
          VALUES ${Prisma.join(values)}
          ON CONFLICT (codigo) DO UPDATE SET
            nombre     = EXCLUDED.nombre,
            razon      = EXCLUDED.razon,
            direccion  = EXCLUDED.direccion,
            localidad  = EXCLUDED.localidad,
            contacto   = EXCLUDED.contacto,
            telefono   = EXCLUDED.telefono,
            fax        = EXCLUDED.fax,
            celular    = EXCLUDED.celular,
            "tipoIva"  = EXCLUDED."tipoIva",
            cuit       = EXCLUDED.cuit,
            cbu        = EXCLUDED.cbu,
            "aliasCbu" = EXCLUDED."aliasCbu",
            "diasVenc" = EXCLUDED."diasVenc",
            iva        = EXCLUDED.iva,
            "ivaDif"   = EXCLUDED."ivaDif",
            email      = EXCLUDED.email,
            observac   = EXCLUDED.observac,
            "detPerc"  = EXCLUDED."detPerc"
        `;
      },
      ({ data, idx }, err) => ({
        rowIndex: idx,
        rawCodigo: data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { data } of insertedRows) {
          if (existingSet.has(data.CODIGO)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }

  return { created, updated, skipped, errors };
}
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/proveedores.test.ts`
Expected: PASS (todos los tests, incluido el nuevo)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/proveedores.ts lib/etl/normalizers/proveedores.test.ts
git commit -m "fix(etl): proveedores aísla la fila corrupta de un lote en vez de perder todo el chunk"
```

---

### Task 3: Aplicar el fallback a `normalizeRubrosArticulo`

**Files:**
- Modify: `lib/etl/normalizers/rubros-articulo.ts`
- Modify: `lib/etl/normalizers/rubros-articulo.test.ts:77-84` (ajustar test existente) y agregar un test nuevo

**Interfaces:**
- Consumes: `insertChunkWithRowFallback`

- [ ] **Step 1: Escribir el test que falla + ajustar el test existente**

En `lib/etl/normalizers/rubros-articulo.test.ts`, reemplazar el test existente (líneas 77-84):

```ts
  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeRubrosArticulo([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });
```

Agregar inmediatamente después un test nuevo:

```ts
  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 15) throw new Error("simulated batch failure");
      if (sql.values[0] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeRubrosArticulo(
      [baseRow({ CODIGO: "BAD" }), baseRow({ CODIGO: "OK" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    expect(res.errors[0].rowIndex).toBe(0);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el nuevo falla**

Run: `npx vitest run lib/etl/normalizers/rubros-articulo.test.ts`
Expected: el test nuevo FALLA con `res.created` = 0. El resto sigue en PASS.

- [ ] **Step 3: Aplicar el fallback en la implementación**

Reemplazar el contenido completo de `lib/etl/normalizers/rubros-articulo.ts` por:

```ts
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { rubroArticuloRowSchema, type RubroArticuloRow } from "../schemas/rubros-articulo";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

const CHUNK_SIZE = 500;

export async function normalizeRubrosArticulo(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  const parsedByCodigo = new Map<string, { data: RubroArticuloRow; idx: number }>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = rubroArticuloRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, { data: parsed.data, idx });
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.data.CODIGO);
  const existingSet = new Set(
    (await prisma.rubroArticulo.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const values = rowsToInsert.map(({ data }) => {
          return Prisma.sql`(
            ${data.CODIGO},
            ${data.NOMBRE ?? "(sin nombre)"},
            ${data.COLOR},
            ${data.GRUPO_NRO},
            ${data.GRUPO_COL},
            ${data.GRUPO_FOT},
            ${data.EXCLUYEINF},
            ${data.EVENTO},
            ${data.DELIACT},
            ${data.EVE_FOR},
            ${data.EVE_FORM},
            ${data.EVE_FORMH},
            ${data.DISCONT}::numeric,
            ${data.FECHA_UPDA},
            ${data.MODO_VISTA}
          )`;
        });

        return Prisma.sql`
          INSERT INTO rubros_articulo (
            codigo, nombre, color, "grupoNro", "grupoCol", "grupoFot",
            "excluyeInf", evento, "deliAct", "eveFor", "eveForm", "eveFormH",
            discont, "fechaUpda", "modoVista"
          )
          VALUES ${Prisma.join(values)}
          ON CONFLICT (codigo) DO UPDATE SET
            nombre        = EXCLUDED.nombre,
            color         = EXCLUDED.color,
            "grupoNro"    = EXCLUDED."grupoNro",
            "grupoCol"    = EXCLUDED."grupoCol",
            "grupoFot"    = EXCLUDED."grupoFot",
            "excluyeInf"  = EXCLUDED."excluyeInf",
            evento        = EXCLUDED.evento,
            "deliAct"     = EXCLUDED."deliAct",
            "eveFor"      = EXCLUDED."eveFor",
            "eveForm"     = EXCLUDED."eveForm",
            "eveFormH"    = EXCLUDED."eveFormH",
            discont       = EXCLUDED.discont,
            "fechaUpda"   = EXCLUDED."fechaUpda",
            "modoVista"   = EXCLUDED."modoVista"
        `;
      },
      ({ data, idx }, err) => ({
        rowIndex: idx,
        rawCodigo: data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { data } of insertedRows) {
          if (existingSet.has(data.CODIGO)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }

  return { created, updated, skipped, errors };
}
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/rubros-articulo.test.ts`
Expected: PASS (todos los tests, incluido el nuevo)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/rubros-articulo.ts lib/etl/normalizers/rubros-articulo.test.ts
git commit -m "fix(etl): rubros-articulo aísla la fila corrupta de un lote en vez de perder todo el chunk"
```

---

### Task 4: Aplicar el fallback a `normalizeSubrubrosArticulo`

**Files:**
- Modify: `lib/etl/normalizers/subrubros-articulo.ts`
- Modify: `lib/etl/normalizers/subrubros-articulo.test.ts:59-66` (ajustar test existente) y agregar un test nuevo

**Interfaces:**
- Consumes: `insertChunkWithRowFallback`

- [ ] **Step 1: Escribir el test que falla + ajustar el test existente**

En `lib/etl/normalizers/subrubros-articulo.test.ts`, reemplazar el test existente (líneas 59-66):

```ts
  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeSubrubrosArticulo([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });
```

Agregar inmediatamente después un test nuevo:

```ts
  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 8) throw new Error("simulated batch failure");
      if (sql.values[0] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeSubrubrosArticulo(
      [baseRow({ CODIGO: "BAD" }), baseRow({ CODIGO: "OK" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    expect(res.errors[0].rowIndex).toBe(0);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el nuevo falla**

Run: `npx vitest run lib/etl/normalizers/subrubros-articulo.test.ts`
Expected: el test nuevo FALLA con `res.created` = 0. El resto sigue en PASS.

- [ ] **Step 3: Aplicar el fallback en la implementación**

Reemplazar el contenido completo de `lib/etl/normalizers/subrubros-articulo.ts` por:

```ts
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { subrubroArticuloRowSchema, type SubrubroArticuloRow } from "../schemas/subrubros-articulo";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

const CHUNK_SIZE = 500;

export async function normalizeSubrubrosArticulo(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  const parsedByCodigo = new Map<string, { data: SubrubroArticuloRow; idx: number }>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = subrubroArticuloRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, { data: parsed.data, idx });
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.data.CODIGO);
  const existingSet = new Set(
    (await prisma.subrubroArticulo.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const values = rowsToInsert.map(({ data }) => {
          const codRua = data.COD_RUA != null && data.COD_RUA > 0 ? String(data.COD_RUA) : null;
          return Prisma.sql`(
            ${data.CODIGO},
            ${data.NOMBRE ?? "(sin nombre)"},
            ${data.DELIACT},
            ${data.EVE_FOR},
            ${data.EVE_FORM},
            ${data.EVE_FORMH},
            ${data.FECHA_UPDA},
            ${codRua}
          )`;
        });

        return Prisma.sql`
          INSERT INTO subrubros_articulo (
            codigo, nombre, "deliAct", "eveFor", "eveForm", "eveFormH", "fechaUpda", "codRua"
          )
          VALUES ${Prisma.join(values)}
          ON CONFLICT (codigo) DO UPDATE SET
            nombre      = EXCLUDED.nombre,
            "deliAct"   = EXCLUDED."deliAct",
            "eveFor"    = EXCLUDED."eveFor",
            "eveForm"   = EXCLUDED."eveForm",
            "eveFormH"  = EXCLUDED."eveFormH",
            "fechaUpda" = EXCLUDED."fechaUpda",
            "codRua"    = EXCLUDED."codRua"
        `;
      },
      ({ data, idx }, err) => ({
        rowIndex: idx,
        rawCodigo: data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { data } of insertedRows) {
          if (existingSet.has(data.CODIGO)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }

  return { created, updated, skipped, errors };
}
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/subrubros-articulo.test.ts`
Expected: PASS (todos los tests, incluido el nuevo)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/subrubros-articulo.ts lib/etl/normalizers/subrubros-articulo.test.ts
git commit -m "fix(etl): subrubros-articulo aísla la fila corrupta de un lote en vez de perder todo el chunk"
```

---

### Task 5: Aplicar el fallback a `normalizeConceptosCaja`

**Files:**
- Modify: `lib/etl/normalizers/conceptos-caja.ts`
- Modify: `lib/etl/normalizers/conceptos-caja.test.ts:48-55` (ajustar test existente) y agregar un test nuevo

**Interfaces:**
- Consumes: `insertChunkWithRowFallback`

- [ ] **Step 1: Escribir el test que falla + ajustar el test existente**

En `lib/etl/normalizers/conceptos-caja.test.ts`, reemplazar el test existente (líneas 48-55):

```ts
  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeConceptosCaja([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });
```

Agregar inmediatamente después un test nuevo:

```ts
  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 5) throw new Error("simulated batch failure");
      if (sql.values[0] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeConceptosCaja(
      [baseRow({ CODIGO: "BAD" }), baseRow({ CODIGO: "OK" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    expect(res.errors[0].rowIndex).toBe(0);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el nuevo falla**

Run: `npx vitest run lib/etl/normalizers/conceptos-caja.test.ts`
Expected: el test nuevo FALLA con `res.created` = 0. El resto sigue en PASS.

- [ ] **Step 3: Aplicar el fallback en la implementación**

Reemplazar el contenido completo de `lib/etl/normalizers/conceptos-caja.ts` por (nota: este archivo tiene una lookup adicional a `rubroConceptoCaja` para validar `COD_RGA` — se preserva tal cual, solo se envuelve el INSERT en el helper):

```ts
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { conceptoCajaRowSchema, type ConceptoCajaRow } from "../schemas/conceptos-caja";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

const CHUNK_SIZE = 500;

export async function normalizeConceptosCaja(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  const parsedByCodigo = new Map<string, { data: ConceptoCajaRow; idx: number }>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = conceptoCajaRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, { data: parsed.data, idx });
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.data.CODIGO);
  const existingSet = new Set(
    (await prisma.conceptoCaja.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  const allCodRga = [...new Set(
    deduped.map((d) => (d.data.COD_RGA != null && d.data.COD_RGA > 0 ? String(d.data.COD_RGA) : null)).filter((v): v is string => v != null)
  )];
  const validRgaSet = new Set(
    (await prisma.rubroConceptoCaja.findMany({ where: { codigo: { in: allCodRga } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const values = rowsToInsert.map(({ data }) => {
          const rawRga = data.COD_RGA != null && data.COD_RGA > 0 ? String(data.COD_RGA) : null;
          const codRga = rawRga != null && (validRgaSet.size === 0 || validRgaSet.has(rawRga)) ? rawRga : null;
          return Prisma.sql`(
            ${data.CODIGO},
            ${data.NOMBRE ?? "(sin nombre)"},
            ${data.TIPO},
            ${data.COD_IMP},
            ${codRga}
          )`;
        });

        return Prisma.sql`
          INSERT INTO conceptos_caja (codigo, nombre, tipo, "codImp", "codRga")
          VALUES ${Prisma.join(values)}
          ON CONFLICT (codigo) DO UPDATE SET
            nombre    = EXCLUDED.nombre,
            tipo      = EXCLUDED.tipo,
            "codImp"  = EXCLUDED."codImp",
            "codRga"  = EXCLUDED."codRga"
        `;
      },
      ({ data, idx }, err) => ({
        rowIndex: idx,
        rawCodigo: data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { data } of insertedRows) {
          if (existingSet.has(data.CODIGO)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }

  return { created, updated, skipped, errors };
}
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/conceptos-caja.test.ts`
Expected: PASS (todos los tests, incluido el nuevo)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/conceptos-caja.ts lib/etl/normalizers/conceptos-caja.test.ts
git commit -m "fix(etl): conceptos-caja aísla la fila corrupta de un lote en vez de perder todo el chunk"
```

---

### Task 6: Aplicar el fallback a `normalizeRubrosConceptoCaja`

**Files:**
- Modify: `lib/etl/normalizers/rubros-concepto-caja.ts`
- Modify: `lib/etl/normalizers/rubros-concepto-caja.test.ts:38-45` (ajustar test existente) y agregar un test nuevo

**Interfaces:**
- Consumes: `insertChunkWithRowFallback`

- [ ] **Step 1: Escribir el test que falla + ajustar el test existente**

En `lib/etl/normalizers/rubros-concepto-caja.test.ts`, reemplazar el test existente (líneas 38-45):

```ts
  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeRubrosConceptoCaja([baseRow()], db);
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/constraint violation/);
  });
```

Agregar inmediatamente después un test nuevo:

```ts
  it("cuando el insert en lote falla, reintenta fila por fila y aísla solo la fila inválida (no pierde las demás)", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 3) throw new Error("simulated batch failure");
      if (sql.values[0] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeRubrosConceptoCaja(
      [baseRow({ CODIGO: "BAD" }), baseRow({ CODIGO: "OK" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
    expect(res.errors[0].rowIndex).toBe(0);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el nuevo falla**

Run: `npx vitest run lib/etl/normalizers/rubros-concepto-caja.test.ts`
Expected: el test nuevo FALLA con `res.created` = 0. El resto sigue en PASS.

- [ ] **Step 3: Aplicar el fallback en la implementación**

Reemplazar el contenido completo de `lib/etl/normalizers/rubros-concepto-caja.ts` por:

```ts
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { rubroConceptoCajaRowSchema, type RubroConceptoCajaRow } from "../schemas/rubros-concepto-caja";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

const CHUNK_SIZE = 500;

export async function normalizeRubrosConceptoCaja(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  // Deduplicar por codigo — last wins (intencional para maestros).
  const parsedByCodigo = new Map<string, { data: RubroConceptoCajaRow; idx: number }>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = rubroConceptoCajaRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, { data: parsed.data, idx });
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.data.CODIGO);
  const existingSet = new Set(
    (await prisma.rubroConceptoCaja.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const values = rowsToInsert.map(({ data }) => {
          return Prisma.sql`(
            ${data.CODIGO},
            ${data.NOMBRE ?? "(sin nombre)"},
            ${data.CALC_RENT}
          )`;
        });

        return Prisma.sql`
          INSERT INTO rubros_concepto_caja (codigo, nombre, "calcRent")
          VALUES ${Prisma.join(values)}
          ON CONFLICT (codigo) DO UPDATE SET
            nombre     = EXCLUDED.nombre,
            "calcRent" = EXCLUDED."calcRent"
            -- visibleEnDashboard: NO se sobreescribe (config manual del usuario)
        `;
      },
      ({ data, idx }, err) => ({
        rowIndex: idx,
        rawCodigo: data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { data } of insertedRows) {
          if (existingSet.has(data.CODIGO)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }

  return { created, updated, skipped, errors };
}
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/rubros-concepto-caja.test.ts`
Expected: PASS (todos los tests, incluido el nuevo)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/rubros-concepto-caja.ts lib/etl/normalizers/rubros-concepto-caja.test.ts
git commit -m "fix(etl): rubros-concepto-caja aísla la fila corrupta de un lote en vez de perder todo el chunk"
```

---

### Task 7: Verificación final

**Files:** ninguno (solo corridas de verificación)

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS, 0 tests rotos en el resto del proyecto.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit final si Steps 1-3 requirieron algún ajuste**

Si todo pasó en verde sin cambios, no hay nada que commitear en este task — es solo un gate de confirmación antes de dar el plan por cerrado.

---

## Fuera de alcance (deliberado)

- El resto de los hallazgos ETL/drive-import/modales/scripts del review original (`canonicalDecimal`, `excelDateToISO`, `linkDetalleCompras` sin try/catch, `use-drive-import.ts`, `maestros-status` GET, `parseFloat` en modales, DELETE de regla, `reset-db.ts`, `cleanup-duplicados-compras.ts`, `migrate-rowid-compras.ts`) quedan para planes separados dentro del mismo bloque de riesgo.
