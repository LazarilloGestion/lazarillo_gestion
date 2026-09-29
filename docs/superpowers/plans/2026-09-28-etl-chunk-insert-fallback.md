# ETL: Aislar Fila Corrupta en Vez de Perder el Lote Completo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando el INSERT en lote de un normalizer ETL falla por una sola fila corrupta, aislar esa fila y persistir el resto en vez de descartar en silencio todo el lote (hasta 499 filas válidas por chunk).

**Architecture:** Se agrega un helper genérico `insertChunkWithRowFallback` que intenta el INSERT del lote completo y, si falla, reintenta fila por fila para aislar la(s) fila(s) realmente inválida(s). Se aplica a los 3 normalizers transaccionales de mayor volumen (compras, ventas, detalle-compras); los 6 normalizers de maestros quedan para un plan de seguimiento (mismo patrón, menor riesgo/volumen).

**Tech Stack:** TypeScript, Prisma (`$executeRaw` + `Prisma.sql`), Vitest.

**Spec:** No hay doc de spec separado — el contrato de comportamiento surge del hallazgo de code-review del 2026-09-20 (capa ETL) y de CLAUDE.md §2 ("ningún error de import/parseo puede fallar en silencio"). Este plan documento es la única fuente de la conducta esperada.

## Global Constraints

- CLAUDE.md §2: ningún error de import/parseo de datos financieros puede fallar en silencio — toda fila que no se persista debe terminar en `errors` con un mensaje específico de esa fila.
- No agregar dependencias nuevas.
- No modificar código fuera del alcance de este plan (no tocar los 6 normalizers de maestros, quedan para el plan de seguimiento).
- Correr `npm test` y `npm run lint` al final de cada tarea.
- Este plan solo cambia código y tests — no ejecuta nada contra la base de producción.

---

### Task 1: Helper `insertChunkWithRowFallback`

**Files:**
- Create: `lib/etl/chunked-upsert.ts`
- Test: `lib/etl/chunked-upsert.test.ts`

**Interfaces:**
- Produces: `insertChunkWithRowFallback<T>(prisma: DbClient, chunk: T[], buildStatement: (rows: T[]) => Prisma.Sql, onRowError: (row: T, err: unknown) => ETLRowError, onRowsInserted: (rows: T[]) => void): Promise<ETLRowError[]>` — usado por Task 2, 3 y 4.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/etl/chunked-upsert.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { insertChunkWithRowFallback } from "./chunked-upsert";
import type { DbClient } from "./types";

function fakeDb(executeRaw: ReturnType<typeof vi.fn>): DbClient {
  return { $executeRaw: executeRaw } as unknown as DbClient;
}

describe("insertChunkWithRowFallback", () => {
  it("el lote se inserta OK de una: no reintenta fila por fila, onRowsInserted recibe el chunk completo", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const db = fakeDb(executeRaw);
    const inserted: number[] = [];
    const errors = await insertChunkWithRowFallback(
      db,
      [1, 2, 3],
      (rows) => Prisma.sql`INSERT ${Prisma.join(rows.map((r) => Prisma.sql`${r}`))}`,
      () => { throw new Error("no debería llamarse"); },
      (rows) => inserted.push(...(rows as number[]))
    );
    expect(errors).toHaveLength(0);
    expect(inserted).toEqual([1, 2, 3]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("el lote falla completo pero cada fila individual es válida: reintenta fila por fila y todas terminan insertadas", async () => {
    let call = 0;
    const executeRaw = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("batch falló");
      return 1;
    });
    const db = fakeDb(executeRaw);
    const inserted: number[] = [];
    const errors = await insertChunkWithRowFallback(
      db,
      [1, 2],
      (rows) => Prisma.sql`INSERT ${Prisma.join(rows.map((r) => Prisma.sql`${r}`))}`,
      () => { throw new Error("no debería llamarse"); },
      (rows) => inserted.push(...(rows as number[]))
    );
    expect(errors).toHaveLength(0);
    expect(inserted.sort()).toEqual([1, 2]);
    expect(executeRaw).toHaveBeenCalledTimes(3); // 1 intento de lote + 2 reintentos individuales
  });

  it("el lote falla completo y una fila individual también falla: esa fila (y solo esa) termina en errors, las demás se insertan", async () => {
    const executeRaw = vi.fn().mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 1) throw new Error("batch falló");
      if (sql.values[0] === "BAD") throw new Error("fila inválida");
      return 1;
    });
    const db = fakeDb(executeRaw);
    const inserted: string[] = [];
    const errors = await insertChunkWithRowFallback(
      db,
      ["OK1", "BAD", "OK2"],
      (rows) => Prisma.sql`INSERT ${Prisma.join(rows.map((r) => Prisma.sql`${r}`))}`,
      (row, err) => ({ rowIndex: 0, rawCodigo: row, message: err instanceof Error ? err.message : String(err) }),
      (rows) => inserted.push(...(rows as string[]))
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].rawCodigo).toBe("BAD");
    expect(inserted.sort()).toEqual(["OK1", "OK2"]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/etl/chunked-upsert.test.ts`
Expected: FAIL con "Cannot find module './chunked-upsert'" (el archivo de implementación todavía no existe).

- [ ] **Step 3: Escribir la implementación mínima**

Crear `lib/etl/chunked-upsert.ts`:

```ts
import type { Prisma } from "@prisma/client";
import type { DbClient, ETLRowError } from "./types";

/**
 * Ejecuta un INSERT ... ON CONFLICT en lote para `chunk`. Si el lote completo
 * falla (por ejemplo, una sola fila con un valor que viola un constraint),
 * reintenta fila por fila para aislar la fila realmente inválida en vez de
 * perder en silencio todas las filas válidas del lote (bug real: un import
 * de 500 filas con 1 fila corrupta perdía las otras 499 sin dejar rastro).
 *
 * `onRowsInserted` se invoca solo con las filas que efectivamente se
 * persistieron — nunca con las que terminaron en `errors` — así que los
 * contadores created/updated que arma el caller quedan siempre correctos.
 */
export async function insertChunkWithRowFallback<T>(
  prisma: DbClient,
  chunk: T[],
  buildStatement: (rows: T[]) => Prisma.Sql,
  onRowError: (row: T, err: unknown) => ETLRowError,
  onRowsInserted: (rows: T[]) => void
): Promise<ETLRowError[]> {
  try {
    await prisma.$executeRaw(buildStatement(chunk));
    onRowsInserted(chunk);
    return [];
  } catch {
    const errors: ETLRowError[] = [];
    const inserted: T[] = [];
    for (const row of chunk) {
      try {
        await prisma.$executeRaw(buildStatement([row]));
        inserted.push(row);
      } catch (err) {
        errors.push(onRowError(row, err));
      }
    }
    onRowsInserted(inserted);
    return errors;
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/etl/chunked-upsert.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/chunked-upsert.ts lib/etl/chunked-upsert.test.ts
git commit -m "feat(etl): agrega helper de fallback fila-por-fila para inserts en lote"
```

---

### Task 2: Aplicar el fallback a `normalizeCompras`

**Files:**
- Modify: `lib/etl/normalizers/compras.ts:1` (import) y `:174-271` (loop de inserción)
- Modify: `lib/etl/normalizers/compras.test.ts:174-181` (ajustar test existente) y agregar un test nuevo

**Interfaces:**
- Consumes: `insertChunkWithRowFallback` (Task 1)

- [ ] **Step 1: Escribir el test que falla + ajustar el test existente**

En `lib/etl/normalizers/compras.test.ts`, reemplazar el test existente (líneas 174-181):

```ts
  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeCompras([baseRow()], db);
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
      if (sql.values.length > 21) throw new Error("simulated batch failure");
      if (sql.values[5] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeCompras(
      [baseRow({ CODIGO: "BAD", DETALLE: null, IMPORTE: 100 }), baseRow({ CODIGO: "OK", DETALLE: null, IMPORTE: 200 })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el nuevo falla**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: el test nuevo ("cuando el insert en lote falla...") FALLA con `res.created` = 0 (el código actual descarta las 2 filas del chunk cuando el INSERT de lote rechaza, no aísla la fila mala). El resto de los tests existentes debería seguir en PASS.

- [ ] **Step 3: Aplicar el fallback en la implementación**

En `lib/etl/normalizers/compras.ts`, agregar el import (junto a los existentes, línea 1-11):

```ts
import { insertChunkWithRowFallback } from "../chunked-upsert";
```

Reemplazar el bloque completo del loop (líneas 174-271, desde `for (let i = 0...` hasta el `}` que cierra el `catch` del loop) por:

```ts
  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);
    const chunkRowIds = chunk.map((pr) => pr.rowId);

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

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const rowValues = rowsToInsert.map(({ rowId, row, data }) => {
          const proveedorId = resolveProveedorId(data.CODIGO, data.PROVEEDOR, provMap);
          const conceptoCodigo = conceptoSet.has(data.COD_CGA) ? data.COD_CGA : null;
          // Solo se calcula cuando NO hay proveedorId real — es la dimensión de
          // matching que usa el motor de Apertura para nivel "proveedor" cuando
          // el ERP no linkeó un proveedor real (ver lib/apertura/motor.ts).
          const proveedorTextoNormalizado = proveedorId == null
            ? normalizarProveedorTexto(data.PROVEEDOR)
            : null;

          return Prisma.sql`(
            ${rowId},
            ${data.COD_CGA},
            ${data.CONCEPTO},
            ${parseComprobanteFromDetalle(row["DETALLE"])},
            ${data.FECHA},
            ${data.CODIGO},
            ${data.PROVEEDOR},
            ${data.DETALLE},
            ${data.OBSERVAC},
            ${data.IMPORTE}::numeric,
            ${data.IMPORTE}::numeric,
            ${data.IMP_INT}::numeric,
            ${data.IMPUTAC},
            ${data.PER1}::numeric,
            ${data.PER2}::numeric,
            ${data.PER3}::numeric,
            ${proveedorId}::integer,
            ${conceptoCodigo},
            ${localId}::integer,
            ${puntoDeVentaId}::integer,
            ${proveedorTextoNormalizado}
          )`;
        });

        return Prisma.sql`
          INSERT INTO compras (
            "rowId", "codCga", concepto, comprobante, fecha, codigo, proveedor, detalle, observac,
            importe, "importeTrabajado", "impInt", imputac, per1, per2, per3,
            "proveedorId", "conceptoCodigo", "localId", "puntoDeVentaId", "proveedorTextoNormalizado"
          )
          VALUES ${Prisma.join(rowValues)}
          ON CONFLICT ("rowId") DO UPDATE SET
            "codCga"           = EXCLUDED."codCga",
            concepto           = EXCLUDED.concepto,
            comprobante        = EXCLUDED.comprobante,
            fecha              = EXCLUDED.fecha,
            codigo             = EXCLUDED.codigo,
            proveedor          = EXCLUDED.proveedor,
            detalle            = EXCLUDED.detalle,
            observac           = EXCLUDED.observac,
            importe            = EXCLUDED.importe,
            "importeTrabajado" = EXCLUDED."importeTrabajado",
            "impInt"           = EXCLUDED."impInt",
            imputac            = EXCLUDED.imputac,
            per1               = EXCLUDED.per1,
            per2               = EXCLUDED.per2,
            per3               = EXCLUDED.per3,
            "proveedorId"      = EXCLUDED."proveedorId",
            "conceptoCodigo"   = EXCLUDED."conceptoCodigo",
            "proveedorTextoNormalizado" = EXCLUDED."proveedorTextoNormalizado",
            -- COALESCE: reclama filas huérfanas (localId=null) sin sobreescribir local ya asignado.
            "localId"          = COALESCE(compras."localId", EXCLUDED."localId"),
            "puntoDeVentaId"   = COALESCE(compras."puntoDeVentaId", EXCLUDED."puntoDeVentaId")
            -- importeManual, fechaManual, conceptoCodigoManual: NO se sobreescriben (overrides manuales)
        `;
      },
      ({ data }, err) => ({
        rowIndex: i,
        rawCodigo: data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { rowId, data } of insertedRows) {
          const oldRow = existingMap.get(rowId);
          if (oldRow) updated++; else created++;
          if (oldRow?.esDistribuido && camposErpCambiaron(erpFieldsDesdeCompraExistente(oldRow), erpFieldsDesdeDatoParseado(data))) {
            comprasDistribuidasModificadas.push(rowId);
          }
        }
      }
    );
    errors.push(...chunkErrors);
  }
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: PASS (todos los tests, incluido el nuevo)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/compras.ts lib/etl/normalizers/compras.test.ts
git commit -m "fix(etl): compras aísla la fila corrupta de un lote en vez de perder todo el chunk"
```

---

### Task 3: Aplicar el fallback a `normalizeVentas`

**Files:**
- Modify: `lib/etl/normalizers/ventas.ts:1` (import) y `:109-192` (loop de inserción)
- Modify: `lib/etl/normalizers/ventas.test.ts:109-116` (ajustar test existente) y agregar un test nuevo

**Interfaces:**
- Consumes: `insertChunkWithRowFallback` (Task 1)

- [ ] **Step 1: Escribir el test que falla + ajustar el test existente**

En `lib/etl/normalizers/ventas.test.ts`, reemplazar el test existente (líneas 109-116):

```ts
  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeVentas([baseRow()], db);
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
      if (sql.values.length > 23) throw new Error("simulated batch failure");
      if (sql.values[2] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeVentas(
      [baseRow({ COMPROBANT: "BAD", TURNO: "1" }), baseRow({ COMPROBANT: "OK", TURNO: "2" })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el nuevo falla**

Run: `npx vitest run lib/etl/normalizers/ventas.test.ts`
Expected: el test nuevo FALLA con `res.created` = 0. El resto sigue en PASS.

- [ ] **Step 3: Aplicar el fallback en la implementación**

En `lib/etl/normalizers/ventas.ts`, agregar el import (junto a los existentes, línea 1-7):

```ts
import { insertChunkWithRowFallback } from "../chunked-upsert";
```

Reemplazar el bloque completo del loop (líneas 109-192, desde `for (let i = 0...` hasta el `}` que cierra el `catch` del loop) por:

```ts
  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);
    const chunkRowIds = chunk.map((pr) => pr.rowId);

    const existingSet = new Set(
      (await prisma.venta.findMany({
        where: { rowId: { in: chunkRowIds } },
        select: { rowId: true },
      })).map((v) => v.rowId)
    );

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const rowValues = rowsToInsert.map(({ rowId, data }) => {
          return Prisma.sql`(
            ${rowId},
            ${data.TURNO},
            ${data.COMPROBANT},
            ${data.HORA},
            ${data.TIPO},
            ${data.MESA},
            ${data.MOZO},
            ${data.CUB},
            ${data.COBRO},
            ${data.COD_COBRO},
            ${data.IMPORTE}::numeric,
            ${data.IMPORTE}::numeric,
            ${data.TOTAL}::numeric,
            ${data.DESCUENTO}::numeric,
            ${data.CLINOMBRE},
            ${data.CLIRAZON},
            ${data.CLICUIT},
            ${data.FECHA},
            ${data.COD_SUC},
            ${data.NOMBRESUC},
            ${data.CUPON},
            ${localId}::integer,
            ${puntoDeVentaId}::integer
          )`;
        });

        return Prisma.sql`
          INSERT INTO ventas (
            "rowId", turno, comprobant, hora, tipo, mesa, mozo, cub, cobro, "codCobro",
            importe, "importeTrabajado", total, descuento, "cliNombre", "cliRazon", "cliCut",
            fecha, "codSuc", "nombreSuc", cupon, "localId", "puntoDeVentaId"
          )
          VALUES ${Prisma.join(rowValues)}
          ON CONFLICT ("rowId") DO UPDATE SET
            turno             = EXCLUDED.turno,
            comprobant        = EXCLUDED.comprobant,
            hora              = EXCLUDED.hora,
            tipo              = EXCLUDED.tipo,
            mesa              = EXCLUDED.mesa,
            mozo              = EXCLUDED.mozo,
            cub               = EXCLUDED.cub,
            cobro             = EXCLUDED.cobro,
            "codCobro"        = EXCLUDED."codCobro",
            importe           = EXCLUDED.importe,
            -- importeTrabajado: NO se sobreescribe (override manual, igual que compras)
            total             = EXCLUDED.total,
            descuento         = EXCLUDED.descuento,
            "cliNombre"       = EXCLUDED."cliNombre",
            "cliRazon"        = EXCLUDED."cliRazon",
            "cliCut"          = EXCLUDED."cliCut",
            fecha             = EXCLUDED.fecha,
            "codSuc"          = EXCLUDED."codSuc",
            "nombreSuc"       = EXCLUDED."nombreSuc",
            cupon             = EXCLUDED.cupon,
            -- COALESCE: reclama filas huérfanas (localId=null) sin sobreescribir local ya asignado.
            "localId"         = COALESCE(ventas."localId", EXCLUDED."localId"),
            "puntoDeVentaId"  = COALESCE(ventas."puntoDeVentaId", EXCLUDED."puntoDeVentaId")
        `;
      },
      ({ data }, err) => ({
        rowIndex: i,
        rawCodigo: data.COMPROBANT,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { rowId } of insertedRows) {
          if (existingSet.has(rowId)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/ventas.test.ts`
Expected: PASS (todos los tests, incluido el nuevo)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/ventas.ts lib/etl/normalizers/ventas.test.ts
git commit -m "fix(etl): ventas aísla la fila corrupta de un lote en vez de perder todo el chunk"
```

---

### Task 4: Aplicar el fallback a `normalizeDetalleCompras`

**Files:**
- Modify: `lib/etl/normalizers/detalle-compras.ts:1` (import) y `:98-188` (loop de inserción)
- Modify: `lib/etl/normalizers/detalle-compras.test.ts:102-109` (ajustar test existente) y agregar un test nuevo

**Interfaces:**
- Consumes: `insertChunkWithRowFallback` (Task 1)

- [ ] **Step 1: Escribir el test que falla + ajustar el test existente**

En `lib/etl/normalizers/detalle-compras.test.ts`, reemplazar el test existente (líneas 102-109):

```ts
  it("un fallo de $executeRaw se reporta en errors sin lanzar excepción", async () => {
    const db = createMockDb();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("constraint violation"));
    const res = await normalizeDetalleCompras([baseRow()], db);
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
      if (sql.values.length > 23) throw new Error("simulated batch failure");
      if (sql.values[1] === "BAD") throw new Error("valor fuera de rango numérico");
      return 1;
    });
    const res = await normalizeDetalleCompras(
      [baseRow({ COD_PRO: "BAD", NETO: 1000 }), baseRow({ COD_PRO: "OK", NETO: 1001 })],
      db
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/valor fuera de rango/);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el nuevo falla**

Run: `npx vitest run lib/etl/normalizers/detalle-compras.test.ts`
Expected: el test nuevo FALLA con `res.created` = 0. El resto sigue en PASS.

- [ ] **Step 3: Aplicar el fallback en la implementación**

En `lib/etl/normalizers/detalle-compras.ts`, agregar el import (junto a los existentes, línea 1-8):

```ts
import { insertChunkWithRowFallback } from "../chunked-upsert";
```

Reemplazar el bloque completo del loop (líneas 98-188, desde `for (let i = 0...` hasta el `}` que cierra el `catch` del loop) por:

```ts
  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);
    const chunkRowIds = chunk.map((pr) => pr.rowId);

    const existingSet = new Set(
      (await prisma.detalleCompra.findMany({
        where: { rowId: { in: chunkRowIds } },
        select: { rowId: true },
      })).map((d) => d.rowId)
    );

    const localId = ctx?.localId ?? null;

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const rowValues = rowsToInsert.map(({ rowId, row, data }) => {
          const articuloCodigo = artSet.has(data.CODIGO) ? data.CODIGO : null;
          // proveedorId nunca se resuelve acá de forma independiente: esta tabla no
          // tiene un campo de texto de proveedor contra el cual validar el CODIGO
          // (a diferencia de compras.ts) — ver spec 2026-09-19-cruce-proveedorid-compras-design.md §3.3.
          const proveedorId = null;
          return Prisma.sql`(
            ${rowId},
            ${data.COD_PRO},
            ${data.COD_CPB},
            ${data.NUMERO1},
            ${data.NUMERO2},
            ${makeComprobante(row)},
            ${data.FECHA},
            ${data.CODIGO},
            ${data.NOMBRE},
            ${data.MEDIDA},
            ${data.CANTIDAD}::numeric,
            ${data.NETO}::numeric,
            ${data.TOTALINS}::numeric,
            ${data.IVATOT}::numeric,
            ${data.IMPINTTOT}::numeric,
            ${data.TASA}::numeric,
            ${data.IVA}::numeric,
            ${data.IMP_INT}::numeric,
            ${data.PERCEP}::numeric,
            ${data.OBSERVAC},
            ${articuloCodigo},
            ${proveedorId}::integer,
            ${localId}::integer
          )`;
        });

        return Prisma.sql`
          INSERT INTO detalle_compras (
            "rowId", "codPro", "codCpb", numero1, numero2, comprobante, fecha, codigo,
            nombre, medida, cantidad, neto, "totalIns", "ivaTot", "impNtTot", tasa, iva,
            "impInt", percep, observac, "articuloCodigo", "proveedorId", "localId"
          )
          VALUES ${Prisma.join(rowValues)}
          ON CONFLICT ("rowId") DO UPDATE SET
            "codPro"        = EXCLUDED."codPro",
            "codCpb"        = EXCLUDED."codCpb",
            numero1         = EXCLUDED.numero1,
            numero2         = EXCLUDED.numero2,
            comprobante     = EXCLUDED.comprobante,
            fecha           = EXCLUDED.fecha,
            codigo          = EXCLUDED.codigo,
            nombre          = EXCLUDED.nombre,
            medida          = EXCLUDED.medida,
            cantidad        = EXCLUDED.cantidad,
            neto            = EXCLUDED.neto,
            "totalIns"      = EXCLUDED."totalIns",
            "ivaTot"        = EXCLUDED."ivaTot",
            "impNtTot"      = EXCLUDED."impNtTot",
            tasa            = EXCLUDED.tasa,
            iva             = EXCLUDED.iva,
            "impInt"        = EXCLUDED."impInt",
            percep          = EXCLUDED.percep,
            observac        = EXCLUDED.observac,
            "articuloCodigo"= EXCLUDED."articuloCodigo",
            "proveedorId"   = EXCLUDED."proveedorId",
            -- COALESCE: reclama filas huérfanas (localId=null) sin sobreescribir local ya asignado.
            "localId"       = COALESCE(detalle_compras."localId", EXCLUDED."localId")
        `;
      },
      ({ data }, err) => ({
        rowIndex: i,
        rawCodigo: data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { rowId } of insertedRows) {
          if (existingSet.has(rowId)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/detalle-compras.test.ts`
Expected: PASS (todos los tests, incluido el nuevo)

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/detalle-compras.ts lib/etl/normalizers/detalle-compras.test.ts
git commit -m "fix(etl): detalle-compras aísla la fila corrupta de un lote en vez de perder todo el chunk"
```

---

### Task 5: Verificación final

**Files:** ninguno (solo corridas de verificación)

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS, 0 tests rotos en el resto del proyecto (nada fuera de `lib/etl/` debería verse afectado).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build exitoso (corre `prisma generate` primero, sin cambios de schema en este plan).

- [ ] **Step 4: Commit final si Steps 1-3 requirieron algún ajuste**

Si todo pasó en verde sin cambios, no hay nada que commitear en este task — es solo un gate de confirmación antes de dar el plan por cerrado.

---

## Fuera de alcance (deliberado)

- Los 6 normalizers de maestros (`articulos.ts`, `proveedores.ts`, `rubros-articulo.ts`, `subrubros-articulo.ts`, `conceptos-caja.ts`, `rubros-concepto-caja.ts`) tienen el mismo patrón de chunk sin fallback, pero son datos maestro (menor volumen, menor blast radius que perder compras/ventas) — quedan para un plan de seguimiento que reutiliza el mismo helper de Task 1.
- `canonicalDecimal()` silencioso, `excelDateToISO` con excepción no capturada en `.refine()`, y el resto de los hallazgos ETL/drive-import/modales/scripts quedan para planes separados dentro del mismo bloque de riesgo.
