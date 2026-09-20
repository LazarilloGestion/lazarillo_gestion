# Apertura de Gastos por proveedor de texto crudo — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir crear Reglas de Apertura de Gastos a nivel "proveedor" para nodos agrupados por texto crudo del ERP (Diego, GASTOS VARIOS, etc.) y para el nodo genuino "Sin Proveedor", que hoy no lo permiten.

**Architecture:** Se agrega una columna persistida `compras.proveedorTextoNormalizado` (calculada por el ETL con la función `normalizarTexto` ya existente) para que el motor de reglas pueda matchear por texto crudo con la misma performance que ya tiene para `proveedorId`. El `entidadId` de una regla de texto reutiliza exactamente la clave `texto:<normalizado>` que ya arma el árbol del pivot, para que agrupación visual y matching de reglas nunca diverjan.

**Tech Stack:** Next.js 16, Prisma 7 (adapter-pg), Postgres, Zod, Vitest, TypeScript estricto.

**Spec:** `docs/superpowers/specs/2026-09-20-apertura-proveedor-texto-crudo-design.md`

## Global Constraints

- El único escritor de `compras.proveedor`/`proveedorId` es el ETL de importación — `proveedorTextoNormalizado` se calcula ahí y en el backfill, en ningún otro lugar.
- `proveedorTextoNormalizado` es `NULL` cuando `proveedorId IS NOT NULL` — nunca se calcula ni se lee en ese caso.
- Normalización SIEMPRE vía `normalizarTexto` de `lib/text-normalize.ts` — nunca reimplementada en SQL ni duplicada inline.
- El prefijo de `entidadId` para nivel "proveedor" por texto crudo es literal `"texto:"` (6 caracteres) — mismo formato que `provKeyOriginal` en `lib/dashboard/pivot-por-proveedor.ts`.
- Fallback cuando no hay texto: literal `"Sin Proveedor"` (con mayúsculas exactas), antes de normalizar — igual que el `COALESCE(..., 'Sin Proveedor')` ya existente en `app/api/dashboard/pivot/route.ts`.
- Ningún cambio de schema Zod: `entidadId: z.string().min(1).max(50)` (`lib/apertura/schemas.ts:126`) ya alcanza (verificado contra datos reales: máximo 33 caracteres con el prefijo).
- Toda tarea que escriba sobre `compras`/`reglas_apertura` de producción real requiere confirmación explícita del usuario antes de `--apply` (CLAUDE.md sección 7) — la Task 7 (backfill) NO debe ejecutarse contra producción de forma autónoma por subagent-driven-development.

---

### Task 1: Migración de Prisma — columna `proveedorTextoNormalizado`

**Files:**
- Modify: `prisma/schema.prisma:164-215` (modelo `Compra`)
- Create: migración generada por Prisma en `prisma/migrations/`

**Interfaces:**
- Produces: columna `compras."proveedorTextoNormalizado"` (`TEXT`, nullable) — consumida por Task 2 (ETL), Task 3 (motor), Task 7 (backfill).

- [ ] **Step 1: Agregar el campo al modelo `Compra`**

En `prisma/schema.prisma`, dentro del modelo `Compra` (línea 164), agregar el campo nuevo junto a `proveedorId`/`proveedorRef` (después de la línea 207 `proveedorRef Proveedor? @relation(...)`):

```prisma
  proveedorId  Int?
  proveedorRef Proveedor? @relation(fields: [proveedorId], references: [id])

  // Apertura de Gastos a nivel proveedor cuando NO hay proveedorId real — texto
  // crudo del ERP normalizado (misma función que agrupa el árbol del pivot, ver
  // lib/text-normalize.ts). NULL cuando proveedorId no es null: en ese caso el
  // motor matchea por proveedorId, este campo no se usa ni se mantiene.
  proveedorTextoNormalizado String?
```

- [ ] **Step 2: Generar y aplicar la migración**

Run: `npx prisma migrate dev --name add_proveedor_texto_normalizado`

Expected: Prisma crea `prisma/migrations/<timestamp>_add_proveedor_texto_normalizado/migration.sql` con un `ALTER TABLE compras ADD COLUMN "proveedorTextoNormalizado" TEXT;` y lo aplica contra la base de desarrollo. `prisma generate` corre automáticamente al final (postinstall/migrate hook) — el cliente de Prisma ya expone `proveedorTextoNormalizado` en `prisma.compra`.

- [ ] **Step 3: Verificar el build**

Run: `npx tsc --noEmit`

Expected: sin errores — el nuevo campo es opcional (`String?`), no rompe ningún `select`/`create` existente.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): agrega columna compras.proveedorTextoNormalizado"
```

---

### Task 2: ETL calcula `proveedorTextoNormalizado`

**Files:**
- Modify: `lib/etl/normalizers/compras.ts`
- Test: `lib/etl/normalizers/compras.test.ts`

**Interfaces:**
- Consumes: `normalizarTexto(s: string): string` de `lib/text-normalize.ts` (ya existente); columna Prisma de Task 1.
- Produces: cada `INSERT`/`UPDATE` de `compras` deja `proveedorTextoNormalizado` correcto — consumido por Task 7 (backfill, mismo criterio para las filas viejas) y por el motor (Task 3) en producción una vez corrido el backfill.

- [ ] **Step 1: Escribir el test que falla**

Agregar en `lib/etl/normalizers/compras.test.ts`, después del test `"PROVEEDOR null en la fila..."` (línea ~108-119):

```ts
  it("proveedorId null: proveedorTextoNormalizado usa el texto crudo normalizado", async () => {
    const db = createMockDb();
    const res = await normalizeCompras([baseRow({ CODIGO: null, PROVEEDOR: "Diego" })], db);
    expect(res.created).toBe(1);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    expect(call.values[16]).toBeNull(); // proveedorId
    expect(call.values[20]).toBe("diego"); // proveedorTextoNormalizado
  });

  it("proveedorId null y sin texto de proveedor: proveedorTextoNormalizado cae a 'Sin Proveedor' normalizado", async () => {
    const db = createMockDb();
    const res = await normalizeCompras([baseRow({ CODIGO: null, PROVEEDOR: null })], db);
    expect(res.created).toBe(1);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    expect(call.values[20]).toBe("sinproveedor");
  });

  it("proveedorId resuelto (no null): proveedorTextoNormalizado queda null, no se calcula", async () => {
    const proveedorModel = {
      findMany: vi.fn().mockResolvedValue([{ id: 5, codigo: "PROV1", nombre: "Juan Perez", razon: null }]),
    };
    const db = createMockDb({ proveedor: proveedorModel });
    const res = await normalizeCompras([baseRow({ CODIGO: "PROV1", PROVEEDOR: "Juan Perez" })], db);
    expect(res.created).toBe(1);
    const call = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0][0] as { values: unknown[] };
    expect(call.values[16]).toBe(5); // proveedorId
    expect(call.values[20]).toBeNull(); // proveedorTextoNormalizado
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: FAIL — `call.values[20]` es `undefined` (la columna todavía no existe en el INSERT), y el mensaje del test lo muestra como distinto de `"diego"`/`"sinproveedor"`/`null`.

- [ ] **Step 3: Implementar**

En `lib/etl/normalizers/compras.ts`, agregar el import (línea 1, junto a los demás imports de `./compra-identity`/`./proveedor-match`):

```ts
import { normalizarTexto } from "../../text-normalize";
```

Dentro del loop de `rowValues` (línea 189-215), calcular el nuevo campo justo después de `proveedorId`:

```ts
      const rowValues = chunk.map(({ rowId, row, data }) => {
        const proveedorId = resolveProveedorId(data.CODIGO, data.PROVEEDOR, provMap);
        const conceptoCodigo = conceptoSet.has(data.COD_CGA) ? data.COD_CGA : null;
        // Solo se calcula cuando NO hay proveedorId real — es la dimensión de
        // matching que usa el motor de Apertura para nivel "proveedor" cuando
        // el ERP no linkeó un proveedor real (ver lib/apertura/motor.ts). Mismo
        // fallback 'Sin Proveedor' que ya usa el COALESCE de
        // app/api/dashboard/pivot/route.ts, para que ambos caminos coincidan.
        const proveedorTextoNormalizado = proveedorId == null
          ? normalizarTexto(data.PROVEEDOR ?? "Sin Proveedor")
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
```

Y el `INSERT` (línea 217-246) agrega la columna al final de la lista y del `ON CONFLICT`:

```ts
      await prisma.$executeRaw(Prisma.sql`
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
      `);
```

**No cambiar el comentario existente de `compras.test.ts:72-73`** ("Índice 16 = columna proveedorId... 20 columnas por fila") a menos que agregues el índice 20 (`proveedorTextoNormalizado`, columna 21 de 21) — actualizalo para reflejar la columna nueva.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: PASS — todos los tests, incluidos los 3 nuevos y los preexistentes (el índice 16 de `proveedorId` no cambió).

- [ ] **Step 5: Commit**

```bash
git add lib/etl/normalizers/compras.ts lib/etl/normalizers/compras.test.ts
git commit -m "feat(etl): calcula proveedorTextoNormalizado cuando no hay proveedorId real"
```

---

### Task 3: Motor de reglas matchea por texto crudo

**Files:**
- Modify: `lib/apertura/motor.ts:26-39`
- Test: `lib/apertura/motor.test.ts`

**Interfaces:**
- Consumes: columna `proveedorTextoNormalizado` de Task 1/2.
- Produces: `export function condicionMatchNivel(nivel: NivelRegla, entidadId: string): Prisma.Sql` (deja de ser privada) — sin cambio de comportamiento para `entidadId` que no empiece con `"texto:"`. Consumido tal cual por `condicionComprasElegibles` y `liberarComprasReclamables`, ya existentes en el mismo archivo — no requieren cambios.

- [ ] **Step 1: Escribir el test que falla**

Agregar en `lib/apertura/motor.test.ts`, importando también `condicionMatchNivel`:

```ts
import { describe, it, expect } from "vitest";
import { compararPrioridadNivel, condicionMatchNivel } from "./motor";

// ... (bloque compararPrioridadNivel existente sin cambios) ...

describe("condicionMatchNivel", () => {
  it("nivel proveedor con entidadId numérico: compara contra proveedorId, como hoy", () => {
    const cond = condicionMatchNivel("proveedor", "123");
    expect(cond.sql).toContain('"proveedorId"::text = ?');
    expect(cond.values).toEqual(["123"]);
  });

  it("nivel proveedor con entidadId 'texto:<normalizado>': compara contra proveedorTextoNormalizado con proveedorId IS NULL", () => {
    const cond = condicionMatchNivel("proveedor", "texto:diego");
    expect(cond.sql).toContain('"proveedorId" IS NULL');
    expect(cond.sql).toContain('"proveedorTextoNormalizado" = ?');
    expect(cond.values).toEqual(["diego"]);
  });

  it("nivel proveedor con entidadId 'texto:sinproveedor' (nodo genuino Sin Proveedor)", () => {
    const cond = condicionMatchNivel("proveedor", "texto:sinproveedor");
    expect(cond.values).toEqual(["sinproveedor"]);
  });

  it("nivel concepto no se ve afectado por el prefijo 'texto:'", () => {
    const cond = condicionMatchNivel("concepto", "GASTO1");
    expect(cond.sql).toContain('"conceptoCodigoManual"');
    expect(cond.values).toEqual(["GASTO1"]);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/apertura/motor.test.ts`
Expected: FAIL — `condicionMatchNivel` no está exportada (`TypeError` o error de import), o si ya compilara, el caso `"texto:diego"` produce `c."proveedorId"::text = ?` con `values: ["texto:diego"]` en vez del branch nuevo.

- [ ] **Step 3: Implementar**

En `lib/apertura/motor.ts`, cambiar la firma de la función (línea 26) de `function` a `export function`, y agregar el branch de texto crudo dentro de la rama `"proveedor"` (línea 27):

```ts
export function condicionMatchNivel(nivel: NivelRegla, entidadId: string): Prisma.Sql {
  if (nivel === "proveedor") {
    // "texto:" identifica una regla sobre un proveedor de texto crudo del ERP
    // (Diego, GASTOS VARIOS, o el nodo genuino "Sin Proveedor" → "texto:sinproveedor")
    // en vez de un proveedorId real — mismo prefijo que ya usa provKeyOriginal en
    // lib/dashboard/pivot-por-proveedor.ts, para que agrupación visual y matching
    // de reglas nunca diverjan. proveedorTextoNormalizado (lib/etl/normalizers/
    // compras.ts) solo se calcula cuando proveedorId es null, así que el AND es
    // necesario: sin él, una compra con proveedorId real cuyo proveedorTextoNormalizado
    // quedó de un import viejo (no aplica hoy, pero no depende de esa garantía)
    // podría matchear por error.
    if (entidadId.startsWith("texto:")) {
      const valorNormalizado = entidadId.slice("texto:".length);
      return Prisma.sql`c."proveedorId" IS NULL AND c."proveedorTextoNormalizado" = ${valorNormalizado}`;
    }
    return Prisma.sql`c."proveedorId"::text = ${entidadId}`;
  }
  // ... resto de la función sin cambios (registro / concepto) ...
```

(Mantener el resto de la función — comentarios y ramas `"registro"`/default de `"concepto"` — exactamente como está hoy, líneas 28-39.)

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/apertura/motor.test.ts`
Expected: PASS — los 4 tests nuevos y todos los `compararPrioridadNivel` preexistentes.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/motor.ts lib/apertura/motor.test.ts
git commit -m "feat(apertura): motor matchea nivel proveedor por texto crudo normalizado"
```

---

### Task 4: `reevaluarCompra` resuelve `entidadId` de texto crudo

**Files:**
- Modify: `lib/apertura/reevaluacion.ts`
- Test: `lib/apertura/reevaluacion.test.ts`

**Interfaces:**
- Consumes: `normalizarTexto` de `lib/text-normalize.ts`.
- Produces: `export function resolverEntidadIdProveedor(compra: { proveedorId: number | null; proveedor: string | null }): string` — nueva función pura, exportada. Usada dentro de `reevaluarCompra` para el nivel `"proveedor"` del array `nivelesAProbar`.

**Contexto para quien implemente:** hoy `reevaluarCompra` (dispara cuando se edita `importeManual`/`fechaManual`/`conceptoCodigoManual` de una compra) resuelve el `entidadId` de nivel proveedor mirando solo `compra.proveedorId` — si es `null`, deja `entidadId: null` y ese nivel se salta por completo (`if (entidadId == null) continue;`, línea 90). Con reglas de texto crudo ya soportadas por el motor (Task 3), esto dejaría a esas compras sin reevaluar nunca contra una regla de texto — hay que resolver el mismo `"texto:<normalizado>"` que usa el motor.

- [ ] **Step 1: Escribir el test que falla**

Agregar en `lib/apertura/reevaluacion.test.ts`, importando también la función nueva:

```ts
import { describe, it, expect } from "vitest";
import { elegirReglaParaCompra, resolverEntidadIdProveedor, type ReglaCandidata } from "./reevaluacion";

// ... (bloque elegirReglaParaCompra existente sin cambios) ...

describe("resolverEntidadIdProveedor", () => {
  it("proveedorId presente: usa el id numérico como string", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: 5, proveedor: "Juan Perez" })).toBe("5");
  });

  it("proveedorId null con texto crudo: usa 'texto:<normalizado>'", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: "Diego" })).toBe("texto:diego");
  });

  it("proveedorId null y sin texto: cae a 'texto:sinproveedor'", () => {
    expect(resolverEntidadIdProveedor({ proveedorId: null, proveedor: null })).toBe("texto:sinproveedor");
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/apertura/reevaluacion.test.ts`
Expected: FAIL — `resolverEntidadIdProveedor` no existe (error de import).

- [ ] **Step 3: Implementar**

En `lib/apertura/reevaluacion.ts`, agregar el import (línea 1, junto a los existentes):

```ts
import { normalizarTexto } from "../text-normalize";
```

Agregar la función pura nueva, antes de `reevaluarCompra` (después de `elegirReglaParaCompra`, línea 41):

```ts
// Mismo criterio que condicionMatchNivel (lib/apertura/motor.ts) para nivel
// "proveedor" — extraída como función pura para poder testearla sin Prisma, y
// para que este archivo y el motor NUNCA puedan resolver un entidadId distinto
// para la misma compra.
export function resolverEntidadIdProveedor(compra: { proveedorId: number | null; proveedor: string | null }): string {
  if (compra.proveedorId != null) return String(compra.proveedorId);
  return `texto:${normalizarTexto(compra.proveedor ?? "Sin Proveedor")}`;
}
```

Modificar el `select` de `reevaluarCompra` (línea 57-66) para traer también `proveedor`:

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

Y cambiar la resolución de `entidadId` de nivel proveedor (línea 82-86):

```ts
  const nivelesAProbar: { nivel: string; entidadId: string | null }[] = [
    { nivel: "registro", entidadId: rowId },
    { nivel: "proveedor", entidadId: resolverEntidadIdProveedor(compra) },
    { nivel: "concepto", entidadId: conceptoEfectivo ?? null },
  ];
```

(`resolverEntidadIdProveedor` nunca devuelve `null` — siempre hay un `entidadId` de nivel proveedor a probar, sea numérico o de texto. El `if (entidadId == null) continue;` de la línea 90 sigue existiendo para el nivel "concepto", que sí puede ser `null`.)

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/apertura/reevaluacion.test.ts`
Expected: PASS — los 3 tests nuevos y los 4 de `elegirReglaParaCompra` preexistentes.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/reevaluacion.ts lib/apertura/reevaluacion.test.ts
git commit -m "fix(apertura): reevaluarCompra resuelve entidadId de proveedor por texto crudo"
```

---

### Task 5: `entidadIdProveedor` en el árbol del pivot por proveedor

**Files:**
- Modify: `lib/dashboard/types.ts:101-110` (`PivotProveedorSubRow`)
- Modify: `lib/dashboard/pivot-por-proveedor.ts:76-94`
- Test: `lib/dashboard/pivot-por-proveedor.test.ts`

**Interfaces:**
- Produces: `PivotProveedorSubRow.entidadIdProveedor: string` — igual a `provKeyOriginal` (mismo valor que ya usa `condicionMatchNivel`/`resolverEntidadIdProveedor` para nivel proveedor). Consumido por Task 6 (UI).

- [ ] **Step 1: Escribir el test que falla**

Agregar en `lib/dashboard/pivot-por-proveedor.test.ts`, después del test `"proveedor_id null: usa el texto crudo del ERP..."` (línea ~73-82):

```ts
  it("entidadIdProveedor: con proveedor_id usa el id como string", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 7, proveedor_nombre: "Proveedor G", row_id: "a1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    expect(data.rows[0].children[0].entidadIdProveedor).toBe("7");
  });

  it("entidadIdProveedor: sin proveedor_id usa 'texto:<normalizado>' del proveedor_nombre", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "Diego", proveedor_texto_crudo: "Diego", row_id: "x1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    expect(data.rows[0].children[0].entidadIdProveedor).toBe("texto:diego");
  });

  it("entidadIdProveedor: nodo genuino Sin Proveedor usa 'texto:sinproveedor'", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "Sin Proveedor", proveedor_texto_crudo: null, row_id: "x1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    expect(data.rows[0].children[0].entidadIdProveedor).toBe("texto:sinproveedor");
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: FAIL — `entidadIdProveedor` es `undefined` (el campo no existe todavía en `PivotProveedorSubRow`).

- [ ] **Step 3: Implementar**

En `lib/dashboard/types.ts`, agregar el campo a `PivotProveedorSubRow` (línea 101-110):

```ts
export type PivotProveedorSubRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;
  readonly proveedorId: number | null;
  readonly proveedorTexto: string | null;
  readonly entidadIdProveedor: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoSubRow[];
};
```

En `lib/dashboard/pivot-por-proveedor.ts`, agregar el campo al objeto `proveedor` (línea 76-94), reusando `provKeyOriginal` que ya se calcula arriba (línea 57-59):

```ts
    if (!proveedorMap.has(provKey)) {
      const proveedor: PivotProveedorSubRow = {
        level: 1,
        id: provKey,
        nombre: proveedor_nombre,
        proveedorId: proveedor_id,
        // Ojo: el filtro de drill-down sale de la columna CRUDA, no del
        // proveedor_nombre del COALESCE — cuando no hay ni proveedor ni texto,
        // proveedor_nombre trae el literal 'Sin Proveedor', que no matchea
        // ninguna fila real de c.proveedor y dejaba el modal vacío. Con null
        // acá, la UI cae a su rama sinProveedor:true.
        proveedorTexto: proveedor_id != null ? null : proveedor_texto_crudo,
        // Mismo valor que ya usa condicionMatchNivel (lib/apertura/motor.ts) y
        // resolverEntidadIdProveedor (lib/apertura/reevaluacion.ts) para nivel
        // "proveedor" — la UI nunca recomputa normalizarTexto por su cuenta,
        // así la clave de agrupación y el entidadId de una regla nueva son
        // byte-idénticos por construcción (docs/superpowers/specs/2026-09-20-
        // apertura-proveedor-texto-crudo-design.md §4.3).
        entidadIdProveedor: provKeyOriginal,
        values: {},
        rowTotal: 0,
        children: [],
      };
      proveedorMap.set(provKey, proveedor);
      rubro.children.push(proveedor);
    }
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: PASS — los 3 tests nuevos y todos los preexistentes del archivo.

- [ ] **Step 5: Correr el resto de la suite y el build**

Run: `npx vitest run && npx tsc --noEmit`
Expected: sin fallos — `entidadIdProveedor` es un campo nuevo y obligatorio en `PivotProveedorSubRow`; si algún otro archivo construye un `PivotProveedorSubRow` a mano (fuera de `pivot-por-proveedor.ts`), `tsc` lo va a señalar. Si aparece un error de este tipo, agregar el campo faltante ahí también con el mismo criterio (`proveedorId != null ? String(proveedorId) : \`texto:${normalizarTexto(nombre)}\``).

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/types.ts lib/dashboard/pivot-por-proveedor.ts lib/dashboard/pivot-por-proveedor.test.ts
git commit -m "feat(dashboard): expone entidadIdProveedor en el árbol por proveedor"
```

---

### Task 6: UI — habilitar apertura en nodos de texto crudo

**Files:**
- Modify: `components/dashboard/pivot-table-por-proveedor.tsx:227-256`

**Interfaces:**
- Consumes: `PivotProveedorSubRow.entidadIdProveedor` de Task 5.

**Nota:** este componente no tiene tests unitarios en el repo (ningún `.tsx` bajo `components/dashboard/` los tiene — las pruebas de esta capa son manuales contra el dashboard real). Esta tarea no lleva pasos de TDD; el criterio de verificación es manual (Step 3).

- [ ] **Step 1: Sacar el gate de `proveedorId != null` y usar `entidadIdProveedor`**

En `components/dashboard/pivot-table-por-proveedor.tsx`, dentro del bloque `if (item.type === "proveedorSub")` (línea 224-289), reemplazar el `AperturaSplitButton` (línea 245-256):

```tsx
                        <AperturaSplitButton
                          variant="block"
                          puedeAperturar={localId != null && pdvId != null}
                          tieneReglaActiva={reglasActivasPorNivel.proveedor.has(proveedor.entidadIdProveedor)}
                          onClick={() => setApertura({
                            nivel: "proveedor",
                            entidadId: proveedor.entidadIdProveedor,
                            entidadNombre: normalize(proveedor.nombre),
                            origenLocalId: localId ?? null,
                            origenPdvId: pdvId ?? null,
                          })}
                        />
```

(Cambios respecto al original: `puedeAperturar` pierde `&& proveedor.proveedorId != null` — queda idéntico al del nivel concepto, línea 314. `tieneReglaActiva` y `entidadId` pasan de `String(proveedor.proveedorId)`/`proveedor.proveedorId` a `proveedor.entidadIdProveedor`. `entidadNombre` no cambia.)

- [ ] **Step 2: Verificar el build y el resto de la suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores — el componente no tiene tests propios, pero `tsc` valida que `proveedor.entidadIdProveedor` exista con el tipo correcto (Task 5).

- [ ] **Step 3: Verificación manual (dashboard real, post-deploy)**

1. Ir a la vista "Compras x Proveedor", con un local y PDV seleccionados (el botón de apertura requiere `localId`/`pdvId`, igual que antes).
2. Confirmar que ahora aparece el botón de apertura junto a nodos como "Diego", "GASTOS VARIOS" y "Sin Proveedor" (antes no aparecía para ninguno de estos).
3. Crear una regla de apertura sobre "Diego" con un destino cualquiera, confirmar que el preview de total (`GET /api/apertura/reglas/preview-total`) muestra un importe mayor a $0 — evidencia de que el motor está matcheando compras reales, no una regla huérfana.
4. Guardar la regla, confirmar que las compras de "Diego" quedan `esDistribuido = true` y que el nodo del árbol refleja la distribución (mismo comportamiento visual que ya existe para un proveedor real con una regla activa).
5. Repetir el punto 3-4 sobre el nodo "Sin Proveedor" (las ~33 filas genuinamente vacías) para confirmar que también es aperturable.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/pivot-table-por-proveedor.tsx
git commit -m "feat(dashboard): habilita apertura de gastos en nodos de proveedor por texto crudo"
```

---

### Task 7: Backfill de producción — `proveedorTextoNormalizado` en filas existentes

**Files:**
- Create: `scripts/backfill-proveedor-texto-normalizado.ts`
- Test: `scripts/backfill-proveedor-texto-normalizado.test.ts`

**Interfaces:**
- Consumes: `normalizarTexto` de `lib/text-normalize.ts`; `prisma` de `lib/prisma.ts`.
- Produces: script CLI standalone, mismo patrón dry-run/backup/apply que `scripts/fix-proveedorid-cruzado.ts` — no expone nada a otro código del repo.

**IMPORTANTE (CLAUDE.md sección 7 / 9.1):** este script escribe sobre `compras` de producción. La ejecución con `--apply` contra la base real **requiere confirmación explícita del usuario** en esta conversación antes de correr — no la ejecute un subagent de forma autónoma. Este riesgo es menor que el de `fix-proveedorid-cruzado.ts` (no borra nada, no toca `proveedorId` ni distribuciones — solo completa una columna nueva, siempre recalculable desde `compras.proveedor`), pero sigue siendo una escritura sobre datos ya importados del cliente.

- [ ] **Step 1: Escribir el test que falla**

Crear `scripts/backfill-proveedor-texto-normalizado.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planBackfillProveedorTexto, type CompraParaBackfill } from "./backfill-proveedor-texto-normalizado";

describe("planBackfillProveedorTexto", () => {
  it("compra sin proveedorId y con texto: calcula el normalizado", () => {
    const compras: CompraParaBackfill[] = [{ rowId: "r1", proveedorId: null, proveedor: "Diego" }];
    const plan = planBackfillProveedorTexto(compras);
    expect(plan.actualizaciones).toEqual([{ rowId: "r1", proveedorTextoNormalizado: "diego" }]);
  });

  it("compra sin proveedorId y sin texto: cae a 'Sin Proveedor' normalizado", () => {
    const compras: CompraParaBackfill[] = [{ rowId: "r1", proveedorId: null, proveedor: null }];
    const plan = planBackfillProveedorTexto(compras);
    expect(plan.actualizaciones).toEqual([{ rowId: "r1", proveedorTextoNormalizado: "sinproveedor" }]);
  });

  it("compra con proveedorId real: no entra al plan (no se toca)", () => {
    const compras: CompraParaBackfill[] = [{ rowId: "r1", proveedorId: 5, proveedor: "Juan Perez" }];
    const plan = planBackfillProveedorTexto(compras);
    expect(plan.actualizaciones).toHaveLength(0);
  });

  it("dos textos crudos distintos: dos actualizaciones separadas", () => {
    const compras: CompraParaBackfill[] = [
      { rowId: "r1", proveedorId: null, proveedor: "Diego" },
      { rowId: "r2", proveedorId: null, proveedor: "GASTOS VARIOS" },
    ];
    const plan = planBackfillProveedorTexto(compras);
    expect(plan.actualizaciones).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run scripts/backfill-proveedor-texto-normalizado.test.ts`
Expected: FAIL — el módulo `./backfill-proveedor-texto-normalizado` no existe todavía.

- [ ] **Step 3: Implementar**

Crear `scripts/backfill-proveedor-texto-normalizado.ts`:

```ts
/**
 * backfill-proveedor-texto-normalizado.ts
 *
 * Completa compras.proveedorTextoNormalizado para las filas ya importadas con
 * proveedorId IS NULL (el ETL, desde este plan en adelante, ya lo calcula para
 * los imports nuevos — ver lib/etl/normalizers/compras.ts). Siempre recalculable
 * desde compras.proveedor: a diferencia de fix-proveedorid-cruzado.ts, este
 * script no borra ni corrige nada existente, solo completa una columna nueva.
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar contra la base real.
 *
 * Uso:
 *   npx tsx scripts/backfill-proveedor-texto-normalizado.ts                          # dry-run
 *   npx tsx scripts/backfill-proveedor-texto-normalizado.ts --apply                  # aplica de verdad
 *   npx tsx scripts/backfill-proveedor-texto-normalizado.ts --apply --esperadas=11826
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { normalizarTexto } from "../lib/text-normalize";

const SCRATCHPAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "backfill-proveedor-texto-normalizado");

export interface CompraParaBackfill {
  rowId: string;
  proveedorId: number | null;
  proveedor: string | null;
}

export interface ActualizacionBackfill {
  rowId: string;
  proveedorTextoNormalizado: string;
}

export interface PlanBackfillProveedorTexto {
  actualizaciones: ActualizacionBackfill[];
}

// Función pura, testable sin base de datos real — mismo criterio de separación
// que planFixProveedorCruzado (fix-proveedorid-cruzado.ts).
export function planBackfillProveedorTexto(compras: CompraParaBackfill[]): PlanBackfillProveedorTexto {
  const actualizaciones = compras
    .filter((c) => c.proveedorId == null)
    .map((c) => ({
      rowId: c.rowId,
      proveedorTextoNormalizado: normalizarTexto(c.proveedor ?? "Sin Proveedor"),
    }));
  return { actualizaciones };
}

function parsearEsperadas(argv: string[]): number | null {
  const arg = argv.find((a) => a.startsWith("--esperadas="));
  if (!arg) return null;
  const valor = Number(arg.slice("--esperadas=".length));
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`--esperadas debe ser un entero no negativo, se recibió "${arg}"`);
  }
  return valor;
}

async function exportarDetalle(actualizaciones: ActualizacionBackfill[], archivo: string) {
  const fs = await import("fs");
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(actualizaciones, null, 2));
  return archivo;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const esperadas = parsearEsperadas(process.argv);

  const compras: CompraParaBackfill[] = await prisma.compra.findMany({
    where: { proveedorId: null },
    select: { rowId: true, proveedorId: true, proveedor: true },
  });
  const plan = planBackfillProveedorTexto(compras);

  console.log(`\n=== Plan de backfill de proveedorTextoNormalizado (${apply ? "aplicando" : "dry-run"}) ===`);
  console.log(`Compras con proveedorId null: ${compras.length}`);
  console.log(`Filas a completar: ${plan.actualizaciones.length}`);

  if (!apply) {
    const archivoDryRun = await exportarDetalle(plan.actualizaciones, `${SCRATCHPAD_DIR}/backfill-dry-run.json`);
    console.log(`Detalle exportado a ${archivoDryRun}`);
    console.log("\nDry-run — no se escribió nada en la base. Re-ejecutar con --apply para aplicar.\n");
    return;
  }

  console.log("\nAplicando...");

  const comprasEnVivo: CompraParaBackfill[] = await prisma.compra.findMany({
    where: { proveedorId: null },
    select: { rowId: true, proveedorId: true, proveedor: true },
  });
  const planEnVivo = planBackfillProveedorTexto(comprasEnVivo);

  if (planEnVivo.actualizaciones.length !== plan.actualizaciones.length) {
    throw new Error(
      `Plan cambió entre el resumen mostrado y la ejecución: se esperaba completar ${plan.actualizaciones.length} filas, ` +
        `pero el recálculo en vivo encontró ${planEnVivo.actualizaciones.length}`
    );
  }

  if (esperadas !== null && planEnVivo.actualizaciones.length !== esperadas) {
    throw new Error(
      `--esperadas=${esperadas} no coincide con el recálculo en vivo: se encontraron ${planEnVivo.actualizaciones.length} filas. ` +
        `La base pudo haber cambiado desde el dry-run aprobado — abortando sin escribir nada.`
    );
  }

  if (planEnVivo.actualizaciones.length === 0) {
    console.log("\nNo hay nada para completar.\n");
    return;
  }

  let actualizadas = 0;
  await prisma.$transaction(async (tx) => {
    for (const { rowId, proveedorTextoNormalizado } of planEnVivo.actualizaciones) {
      const resultado = await tx.compra.updateMany({
        where: { rowId, proveedorId: null },
        data: { proveedorTextoNormalizado },
      });
      actualizadas += resultado.count;
    }
  }, { timeout: 30000, maxWait: 20000 });

  if (actualizadas !== planEnVivo.actualizaciones.length) {
    throw new Error(
      `Verificación falló: se esperaba completar ${planEnVivo.actualizaciones.length} filas, se actualizaron ${actualizadas}`
    );
  }

  const archivoAplicado = await exportarDetalle(planEnVivo.actualizaciones, `${SCRATCHPAD_DIR}/backfill-aplicado.json`);
  console.log(`\n=== Verificación post-backfill ===`);
  console.log(`Filas completadas: ${actualizadas}`);
  console.log(`Detalle exportado a ${archivoAplicado}`);
  console.log("\nBackfill completado y verificado.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run scripts/backfill-proveedor-texto-normalizado.test.ts`
Expected: PASS — los 4 casos.

- [ ] **Step 5: Commit (sin ejecutar `--apply`)**

```bash
git add scripts/backfill-proveedor-texto-normalizado.ts scripts/backfill-proveedor-texto-normalizado.test.ts
git commit -m "feat(scripts): backfill de proveedorTextoNormalizado para compras existentes"
```

- [ ] **Step 6: DETENERSE — no ejecutar contra producción sin autorización**

No correr `npx tsx scripts/backfill-proveedor-texto-normalizado.ts --apply` como parte de esta tarea. El dry-run (`npx tsx scripts/backfill-proveedor-texto-normalizado.ts`, sin flags) sí puede correrse para mostrarle el reporte al usuario — es de solo lectura. La ejecución con `--apply` contra la base real queda para un paso posterior, en la conversación principal, con el usuario presente y su confirmación explícita — igual que la Task 5 de `docs/superpowers/plans/2026-09-19-cruce-proveedorid-compras.md`.

---

## Resumen de tareas

| Task | Qué hace | Requiere confirmación de producción |
|---|---|---|
| 1 | Migración Prisma (columna nueva) | No (dev DB / migración estándar) |
| 2 | ETL calcula la columna en imports nuevos | No |
| 3 | Motor matchea nivel proveedor por texto | No |
| 4 | `reevaluarCompra` resuelve el mismo entidadId | No |
| 5 | Árbol del pivot expone `entidadIdProveedor` | No |
| 6 | UI habilita el botón de apertura | No (verificación manual post-deploy) |
| 7 | Backfill de las ~11.826 filas existentes | **Sí** — `--apply` requiere luz verde explícita del usuario |
