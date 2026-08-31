# Apertura de gastos — Fixes (origen de regla, tooltip de composición, reevaluación al editar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acotar las reglas de apertura a su local/PDV de origen, mostrar la composición porcentual de un concepto aperturado en un tooltip, y reevaluar las reglas vigentes cuando se edita manualmente una compra.

**Architecture:** Se agrega origen (local/PDV, misma semántica que los destinos) a `reglas_apertura` con una migración destructiva de reglas/distribuciones (entorno dev). El motor (`lib/apertura/motor.ts`) filtra las compras elegibles por origen; la validación de superposición se acota al mismo origen. Un nuevo módulo `lib/apertura/reevaluacion.ts` recalcula la distribución de una sola compra tras editarla, disparado desde `PATCH /api/dashboard/compras/[rowId]`. El endpoint de pivot emite un segundo query que agrupa `distribuciones_apertura` por concepto+mes+destino para alimentar el tooltip.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, TypeScript 5 (estricto), Prisma 7 + `@prisma/adapter-pg`, Zod 4, TanStack Query, shadcn/radix-ui, vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-apertura-fixes-origen-tooltip-reeval-design.md`

## Global Constraints

- **Package manager:** npm. Scripts: `npm run dev`, `npm run build` (corre `prisma generate` antes), `npm run lint`, `npx vitest run`.
- **No dependencias nuevas.** UI: usar shadcn/radix-ui ya presentes (`Tooltip`, `ConfirmDialog`, `Select`, `Input`, `Dialog`).
- **TypeScript estricto, sin `any`** sin comentario que lo justifique.
- **Validación de datos externos con Zod `safeParse`** en todo route handler (body y query params).
- **Manejo de errores explícito** — prohibido `catch {}` vacío; ningún error de parseo/cálculo financiero puede fallar en silencio.
- **Toda query a la base pasa por Prisma** (`prisma.$queryRaw` / cliente tipado); no `pg` directo.
- **Cambios de schema solo vía `prisma migrate`.** La migración de la Task 1 es destructiva (borra reglas/distribuciones, resetea `esDistribuido`) y **requiere confirmación explícita del usuario antes de correr** (CLAUDE.md §7). Válida solo porque estamos en dev y las reglas se dan de baja sin backfill. La data de compras del ERP NO se toca — solo los flags `esDistribuido` / `distribuidoEn`.
- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- **Autorización:** todo route handler nuevo/modificado mantiene `requireAuth` / `requireAuthUser` como los existentes.
- **Prisma.Decimal → number:** siempre `Number(x.toString())`, nunca `Number(x)` directo (patrón del repo).
- **Semántica de origen y destino (idéntica):** `puntoDeVentaId` seteado → ese PDV puntual; solo `localId` → todo el local (todos sus PDV). "Compiten por la misma plata" = mismo local y (mismo PDV, o al menos uno es "todo el local").
- **Fuera de alcance:** nivel proveedor/registro de reglas; el concepto "Descartado" (indefinido); cambio de forma de `v_compras_distribuidas`; backfill de reglas.

---

## File Structure

**Schema / migración**
- Modify: `prisma/schema.prisma` — `ReglaApertura` (+`origenLocalId`, `origenPuntoDeVentaId`, relaciones, índice), `Local` y `PuntoDeVenta` (+relación inversa `reglasOrigen`).
- Create: `prisma/migrations/<timestamp>_apertura_origen_regla/migration.sql`

**Dominio (`lib/apertura/`)**
- Modify: `lib/apertura/validaciones.ts` — `origenesSuperpuestos(a,b)`, `origenAlcanza(origen, ubicacion)`
- Modify: `lib/apertura/validaciones.test.ts`
- Modify: `lib/apertura/vigencia.ts` — `fechaEnVigencia(fecha, regla)`
- Modify: `lib/apertura/vigencia.test.ts`
- Modify: `lib/apertura/motor.ts` — origen en `condicionComprasElegibles` / `aplicarRegla` / `verificarSinSuperposicion`; nuevos `resolverLocalIdOrigen`, `aplicarReglaACompra`
- Modify: `lib/apertura/schemas.ts` — campos de origen en `crearReglaSchema`, `patchReglaSchema` (rama editar), `previewTotalQuerySchema`
- Modify: `lib/apertura/schemas.test.ts`
- Modify: `lib/apertura/types.ts` — `ReglaAperturaDTO` (+origen)
- Create: `lib/apertura/reevaluacion.ts` — `elegirReglaParaCompra` (pura), `reevaluarCompra` (orquestación)
- Create: `lib/apertura/reevaluacion.test.ts`
- Modify: `lib/apertura/reimportacion.ts` — pasa origen a `aplicarRegla`

**Dashboard (`lib/dashboard/`)**
- Create: `lib/dashboard/apertura-composicion.ts` — `buildComposicion(rows)` (pura)
- Create: `lib/dashboard/apertura-composicion.test.ts`
- Modify: `lib/dashboard/types.ts` — `PivotConceptoRow.composicion?`, tipo `ComposicionMes`, `ComposicionSqlRow`

**API (`app/api/`)**
- Modify: `app/api/apertura/reglas/route.ts` — POST persiste origen + lo pasa a `verificarSinSuperposicion` / `aplicarRegla`; GET DTO
- Modify: `app/api/apertura/reglas/[id]/route.ts` — PATCH (rama editar) idem
- Modify: `app/api/apertura/reglas/preview-total/route.ts` — origen a `condicionComprasElegibles`
- Modify: `app/api/dashboard/compras/[rowId]/route.ts` — saca guard 409, `$transaction` + `reevaluarCompra`
- Modify: `app/api/dashboard/pivot/route.ts` — segundo `$queryRaw` de composición + merge en `buildPivotData`

**UI (`components/dashboard/`)**
- Create: `components/dashboard/apertura-origen-selector.tsx`
- Modify: `components/dashboard/apertura-gastos-modal.tsx` — estado `origen`, selector, preview, cards, deshabilitar Guardar
- Modify: `components/dashboard/apertura-timeline.tsx` — filtra por origen solapado
- Modify: `components/dashboard/pivot-table.tsx` — indicador sensible a `localId`/`pdvId`; `Tooltip` de composición en la celda de concepto
- Modify: `components/dashboard/compras-detalle-modal.tsx` — habilita lápiz en filas distribuidas + `ConfirmDialog` de recálculo

---

## Task 1: Schema y migración destructiva del origen

**Files:**
- Modify: `prisma/schema.prisma` (models `Local` ~L11, `PuntoDeVenta` ~L25, `ReglaApertura` ~L311)
- Create: `prisma/migrations/<timestamp>_apertura_origen_regla/migration.sql`

**Interfaces:**
- Produces: columnas `reglas_apertura.origenLocalId` (Int?, FK `locales.id`), `reglas_apertura.origenPuntoDeVentaId` (Int?, FK `puntos_de_venta.id`); campos Prisma `ReglaApertura.origenLocalId` / `origenPuntoDeVentaId` / `origenLocal` / `origenPuntoDeVenta`.

- [ ] **Step 1: Confirmar con el usuario antes de tocar la base**

Antes de ejecutar nada, mostrar al usuario el contenido exacto del `migration.sql` (Step 3) y esperar su "sí" explícito. Es la única operación destructiva del plan. NO continuar sin confirmación.

- [ ] **Step 2: Editar `prisma/schema.prisma`**

En `model ReglaApertura`, después de `entidadId String`:

```prisma
  origenLocalId        Int?
  origenPuntoDeVentaId Int?
```

Antes del cierre del bloque (junto a las otras relaciones/índices):

```prisma
  origenLocal        Local?        @relation("reglaOrigenLocal", fields: [origenLocalId], references: [id])
  origenPuntoDeVenta PuntoDeVenta? @relation("reglaOrigenPdv", fields: [origenPuntoDeVentaId], references: [id])
```

Cambiar el índice existente `@@index([entidadId, nivel])` por:

```prisma
  @@index([entidadId, nivel, origenLocalId, origenPuntoDeVentaId])
```

En `model Local`, agregar a la lista de relaciones:

```prisma
  reglasOrigen ReglaApertura[] @relation("reglaOrigenLocal")
```

En `model PuntoDeVenta`, agregar:

```prisma
  reglasOrigen ReglaApertura[] @relation("reglaOrigenPdv")
```

- [ ] **Step 3: Crear la migración a mano y revisarla**

Correr `npx prisma migrate dev --create-only --name apertura_origen_regla` para generar el esqueleto, después **reemplazar** el `migration.sql` por exactamente esto (el generador no incluye el CHECK ni el wipe de datos):

```sql
-- Origen (local/PDV) de la regla de apertura. Ver
-- docs/superpowers/specs/2026-08-31-apertura-fixes-origen-tooltip-reeval-design.md

ALTER TABLE "reglas_apertura"
  ADD COLUMN "origenLocalId" INTEGER,
  ADD COLUMN "origenPuntoDeVentaId" INTEGER;

ALTER TABLE "reglas_apertura"
  ADD CONSTRAINT "reglas_apertura_origen_local_fkey"
  FOREIGN KEY ("origenLocalId") REFERENCES "locales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reglas_apertura"
  ADD CONSTRAINT "reglas_apertura_origen_pdv_fkey"
  FOREIGN KEY ("origenPuntoDeVentaId") REFERENCES "puntos_de_venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reglas_apertura"
  ADD CONSTRAINT "reglas_apertura_origen_no_nulo"
  CHECK ("origenLocalId" IS NOT NULL OR "origenPuntoDeVentaId" IS NOT NULL);

DROP INDEX IF EXISTS "reglas_apertura_entidadId_nivel_idx";
CREATE INDEX "reglas_apertura_entidadId_nivel_origenLocalId_origenPuntoDeVentaId_idx"
  ON "reglas_apertura"("entidadId", "nivel", "origenLocalId", "origenPuntoDeVentaId");

-- Entorno dev: las reglas vigentes se dan de baja, sin backfill. La data de
-- compras del ERP no se toca — solo los flags de apertura.
DELETE FROM "distribuciones_apertura";
DELETE FROM "destinos_regla";
DELETE FROM "reglas_apertura";
UPDATE "compras" SET "esDistribuido" = false, "distribuidoEn" = NULL WHERE "esDistribuido" = true;
```

(El nombre real del índice viejo puede diferir — verificar con `\d reglas_apertura` en psql o mirar el `migration.sql` original de `20260819141156_apertura_gastos_schema`. Si el `DROP INDEX` no matchea, ajustar el nombre; el `IF EXISTS` evita que falle.)

- [ ] **Step 4: Aplicar la migración**

Run: `npx prisma migrate dev` (sin `--create-only`; aplica la migración pendiente y regenera el client).
Expected: "Your database is now in sync with your schema." + client regenerado.

- [ ] **Step 5: Verificar el estado post-migración**

Run:
```bash
npx prisma db execute --stdin <<'SQL'
SELECT
  (SELECT count(*) FROM reglas_apertura)         AS reglas,
  (SELECT count(*) FROM destinos_regla)          AS destinos,
  (SELECT count(*) FROM distribuciones_apertura) AS distribuciones,
  (SELECT count(*) FROM compras WHERE "esDistribuido")  AS compras_distribuidas;
SQL
```
Expected: las cuatro cuentas en 0. Si `compras_distribuidas` != 0, PARAR y avisar al usuario (salida inesperada — CLAUDE.md §7).

- [ ] **Step 6: Verificar que el proyecto compila**

Run: `npx tsc --noEmit` (o `npm run build`).
Expected: sin errores de tipo por el nuevo campo (todavía nadie lo consume — OK).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(apertura): agrega origen (local/PDV) a reglas_apertura + wipe de reglas en dev"
```

---

## Task 2: Helpers puros de origen (`origenesSuperpuestos`, `origenAlcanza`)

**Files:**
- Modify: `lib/apertura/validaciones.ts`
- Test: `lib/apertura/validaciones.test.ts`

**Interfaces:**
- Consumes: `DestinoBasico` (`{ localId: number | null; puntoDeVentaId: number | null }`) ya exportado en `validaciones.ts`.
- Produces:
  - `origenesSuperpuestos(a: DestinoBasico, b: DestinoBasico): boolean` — true si compiten por la misma plata.
  - `origenAlcanza(origen: DestinoBasico, ubicacion: { localId: number | null; puntoDeVentaId: number | null }): boolean` — true si una compra en `ubicacion` cae bajo `origen`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `lib/apertura/validaciones.test.ts` (nuevo import: `origenesSuperpuestos, origenAlcanza`):

```typescript
describe("origenesSuperpuestos", () => {
  it("mismo PDV puntual del mismo local: compiten", () => {
    expect(origenesSuperpuestos({ localId: 1, puntoDeVentaId: 10 }, { localId: 1, puntoDeVentaId: 10 })).toBe(true);
  });
  it("PDV puntual vs 'todo el local' del mismo local: compiten", () => {
    expect(origenesSuperpuestos({ localId: 1, puntoDeVentaId: 10 }, { localId: 1, puntoDeVentaId: null })).toBe(true);
  });
  it("PDV distintos del mismo local: no compiten", () => {
    expect(origenesSuperpuestos({ localId: 1, puntoDeVentaId: 10 }, { localId: 1, puntoDeVentaId: 20 })).toBe(false);
  });
  it("locales distintos: no compiten", () => {
    expect(origenesSuperpuestos({ localId: 1, puntoDeVentaId: null }, { localId: 2, puntoDeVentaId: null })).toBe(false);
  });
});

describe("origenAlcanza", () => {
  it("origen = PDV puntual: alcanza solo a las compras de ese PDV", () => {
    expect(origenAlcanza({ localId: 1, puntoDeVentaId: 10 }, { localId: 1, puntoDeVentaId: 10 })).toBe(true);
    expect(origenAlcanza({ localId: 1, puntoDeVentaId: 10 }, { localId: 1, puntoDeVentaId: 20 })).toBe(false);
  });
  it("origen = todo el local: alcanza a cualquier compra de ese local", () => {
    expect(origenAlcanza({ localId: 1, puntoDeVentaId: null }, { localId: 1, puntoDeVentaId: 20 })).toBe(true);
    expect(origenAlcanza({ localId: 1, puntoDeVentaId: null }, { localId: 2, puntoDeVentaId: 99 })).toBe(false);
  });
  it("compra sin local asignado: no la alcanza ningún origen", () => {
    expect(origenAlcanza({ localId: 1, puntoDeVentaId: null }, { localId: null, puntoDeVentaId: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/apertura/validaciones.test.ts`
Expected: FAIL — `origenesSuperpuestos is not a function` / `origenAlcanza is not a function`.

- [ ] **Step 3: Implementar en `lib/apertura/validaciones.ts`**

Después de `destinosSuperpuestos` (que ya implementa exactamente la semántica de "compiten"):

```typescript
// Alias semántico: dos ORÍGENES compiten por la misma plata bajo la misma
// regla que dos destinos — mismo local y (mismo PDV puntual, o al menos uno
// es "todo el local"). Se reexpone con nombre propio para que los callers de
// superposición de reglas (motor.verificarSinSuperposicion) y el indicador
// del dashboard lean la intención sin depender del nombre "destino".
export function origenesSuperpuestos(a: DestinoBasico, b: DestinoBasico): boolean {
  return destinosSuperpuestos(a, b);
}

// ¿Una compra ubicada en `ubicacion` cae bajo el `origen` de una regla?
// origen con puntoDeVentaId → solo ese PDV; origen solo con localId → todo el
// local. Una compra sin localId (dato de ubicación ausente) no la alcanza
// ninguna regla — no hay forma de saber su origen (ver spec sección 4.1).
export function origenAlcanza(
  origen: DestinoBasico,
  ubicacion: { localId: number | null; puntoDeVentaId: number | null }
): boolean {
  if (origen.puntoDeVentaId != null) return ubicacion.puntoDeVentaId === origen.puntoDeVentaId;
  return ubicacion.localId != null && ubicacion.localId === origen.localId;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/apertura/validaciones.test.ts`
Expected: PASS (todos, incluidos los previos).

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/validaciones.ts lib/apertura/validaciones.test.ts
git commit -m "feat(apertura): helpers puros origenesSuperpuestos y origenAlcanza"
```

---

## Task 3: Helper puro `fechaEnVigencia`

**Files:**
- Modify: `lib/apertura/vigencia.ts`
- Test: `lib/apertura/vigencia.test.ts`

**Interfaces:**
- Consumes: `ReglaVigencia`, `resolverVigencia` (ya en `vigencia.ts`).
- Produces: `fechaEnVigencia(fecha: Date, regla: ReglaVigencia): boolean`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `lib/apertura/vigencia.test.ts` (import `fechaEnVigencia`):

```typescript
describe("fechaEnVigencia", () => {
  const entreEneEne: ReglaVigencia = {
    modo: "entre_fechas", extremosInclusivos: true,
    fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-01-31"),
  };
  it("historico: cualquier fecha", () => {
    expect(fechaEnVigencia(new Date("1999-05-05"), { modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true })).toBe(true);
  });
  it("entre_fechas inclusivo: dentro true, fuera false, borde true", () => {
    expect(fechaEnVigencia(new Date("2026-01-15"), entreEneEne)).toBe(true);
    expect(fechaEnVigencia(new Date("2026-02-01"), entreEneEne)).toBe(false);
    expect(fechaEnVigencia(new Date("2026-01-31"), entreEneEne)).toBe(true);
  });
  it("entre_fechas exclusivo: borde false", () => {
    expect(fechaEnVigencia(new Date("2026-01-31"), { ...entreEneEne, extremosInclusivos: false })).toBe(false);
  });
  it("desde_adelante: fechas >= desde", () => {
    const v: ReglaVigencia = { modo: "desde_adelante", extremosInclusivos: true, fechaDesde: new Date("2026-06-01"), fechaHasta: null };
    expect(fechaEnVigencia(new Date("2026-06-01"), v)).toBe(true);
    expect(fechaEnVigencia(new Date("2026-05-31"), v)).toBe(false);
  });
  it("desde_atras: fechas <= hasta", () => {
    const v: ReglaVigencia = { modo: "desde_atras", extremosInclusivos: true, fechaDesde: null, fechaHasta: new Date("2026-06-30") };
    expect(fechaEnVigencia(new Date("2026-06-30"), v)).toBe(true);
    expect(fechaEnVigencia(new Date("2026-07-01"), v)).toBe(false);
  });
});
```

Si `ReglaVigencia` no está importado en el test, agregar `import type { ReglaVigencia } from "./vigencia";`.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/apertura/vigencia.test.ts`
Expected: FAIL — `fechaEnVigencia is not a function`.

- [ ] **Step 3: Implementar en `lib/apertura/vigencia.ts`**

Después de `resolverVigencia` (antes de `vigenciaToSql`):

```typescript
// Puro — versión en memoria de vigenciaToSql, para decidir si UNA compra
// concreta cae en la ventana de una regla (lib/apertura/reevaluacion.ts).
// vigenciaToSql sigue siendo la fuente para el filtrado masivo en SQL; esta
// función replica la MISMA semántica de extremos para el caso puntual.
export function fechaEnVigencia(fecha: Date, regla: ReglaVigencia): boolean {
  const cond = resolverVigencia(regla);
  const t = fecha.getTime();
  switch (cond.tipo) {
    case "historico":
      return true;
    case "entre_fechas":
      return cond.inclusivo
        ? t >= cond.desde.getTime() && t <= cond.hasta.getTime()
        : t > cond.desde.getTime() && t < cond.hasta.getTime();
    case "desde_adelante":
      return cond.inclusivo ? t >= cond.desde.getTime() : t > cond.desde.getTime();
    case "desde_atras":
      return cond.inclusivo ? t <= cond.hasta.getTime() : t < cond.hasta.getTime();
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/apertura/vigencia.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/vigencia.ts lib/apertura/vigencia.test.ts
git commit -m "feat(apertura): fechaEnVigencia — check puntual de vigencia en memoria"
```

---

## Task 4: Campos de origen en los schemas Zod

**Files:**
- Modify: `lib/apertura/schemas.ts`
- Test: `lib/apertura/schemas.test.ts`

**Interfaces:**
- Produces:
  - `crearReglaSchema` y `patchReglaSchema` (rama `editar`) aceptan y exigen `origenLocalId?: number | null` + `origenPuntoDeVentaId?: number | null` con al menos uno no-null.
  - `previewTotalQuerySchema` acepta `origenLocalId` / `origenPuntoDeVentaId` (coerce a number, opcionales, al menos uno).
  - `CrearReglaInput` / `PatchReglaInput` / `PreviewTotalQuery` reflejan los campos nuevos.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `lib/apertura/schemas.test.ts`:

```typescript
describe("origen de la regla", () => {
  const base = {
    entidadId: "17", modo: "historico" as const, confirmarHistorico: true,
    destinos: [{ localId: 1, porcentaje: 60 }, { localId: 2, porcentaje: 40 }],
  };
  it("acepta origen con solo origenLocalId", () => {
    expect(crearReglaSchema.safeParse({ ...base, origenLocalId: 1 }).success).toBe(true);
  });
  it("acepta origen con origenPuntoDeVentaId", () => {
    expect(crearReglaSchema.safeParse({ ...base, origenPuntoDeVentaId: 10 }).success).toBe(true);
  });
  it("rechaza cuerpo sin ningún campo de origen", () => {
    expect(crearReglaSchema.safeParse(base).success).toBe(false);
  });
  it("rechaza origen con ambos campos en null", () => {
    expect(crearReglaSchema.safeParse({ ...base, origenLocalId: null, origenPuntoDeVentaId: null }).success).toBe(false);
  });
  it("previewTotalQuerySchema coerce origenLocalId de string", () => {
    const r = previewTotalQuerySchema.safeParse({ entidadId: "17", modo: "historico", origenLocalId: "3" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.origenLocalId).toBe(3);
  });
  it("previewTotalQuerySchema rechaza sin origen", () => {
    expect(previewTotalQuerySchema.safeParse({ entidadId: "17", modo: "historico" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/apertura/schemas.test.ts`
Expected: FAIL (los `success` esperados no coinciden — hoy el origen se ignora).

- [ ] **Step 3: Implementar en `lib/apertura/schemas.ts`**

Agregar un objeto de campos reutilizable + refine, antes de `camposVigenciaFecha`:

```typescript
// Origen (local/PDV) — al menos uno seteado, misma semántica que destinoSchema.
export const camposOrigen = {
  origenLocalId: z.number().int().positive().nullable().optional(),
  origenPuntoDeVentaId: z.number().int().positive().nullable().optional(),
};

function validarOrigen(
  data: { origenLocalId?: number | null; origenPuntoDeVentaId?: number | null },
  ctx: z.RefinementCtx
) {
  if (data.origenLocalId == null && data.origenPuntoDeVentaId == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "La regla requiere un origen: origenLocalId o origenPuntoDeVentaId",
      path: ["origenLocalId"],
    });
  }
}
```

En `camposVigencia` (el objeto que usa crear + editar) agregar `...camposOrigen`.

En `validarCuerpoRegla`, agregar al final `validarOrigen(data, ctx);` y ampliar su tipo de parámetro `data` con `origenLocalId?: number | null; origenPuntoDeVentaId?: number | null`.

En `previewTotalQuerySchema`: agregar `...camposOrigen` con `z.coerce.number().int().positive().nullable().optional()` (no el de `camposOrigen` directo — query params llegan como string; definir inline):

```typescript
export const previewTotalQuerySchema = z
  .object({
    entidadId: z.string().min(1).max(50),
    reglaId: z.coerce.number().int().positive().optional(),
    origenLocalId: z.coerce.number().int().positive().nullable().optional(),
    origenPuntoDeVentaId: z.coerce.number().int().positive().nullable().optional(),
    ...camposVigenciaFecha,
  })
  .superRefine((data, ctx) => {
    validarFechasPorModo(data, ctx);
    validarOrigen(data, ctx);
  });
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/apertura/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/schemas.ts lib/apertura/schemas.test.ts
git commit -m "feat(apertura): campos de origen en los schemas de crear/editar/preview"
```

---

## Task 5: Motor — origen en `condicionComprasElegibles`, `aplicarRegla`, `resolverLocalIdOrigen`

**Files:**
- Modify: `lib/apertura/motor.ts`

**Interfaces:**
- Consumes: `origenAlcanza` (Task 2) no se usa acá (es SQL); se usa `Prisma.sql`.
- Produces:
  - `condicionComprasElegibles(entidadId, vigenciaSql, origen, reglaEnEdicionId?)` — nueva firma, `origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null }` como 3er parámetro (antes 3er param era `reglaEnEdicionId`).
  - `AplicarReglaInput` suma `origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null }`.
  - `resolverLocalIdOrigen(prisma, origen): Promise<{ origenLocalId: number | null; origenPuntoDeVentaId: number | null }>` — resuelve `origenLocalId` cuando solo vino PDV.

- [ ] **Step 1: `resolverLocalIdOrigen`**

En `lib/apertura/motor.ts`, después de `resolverLocalIdDestinos`:

```typescript
// Igual que resolverLocalIdDestinos pero para el ORIGEN único de una regla:
// si vino solo puntoDeVentaId, completa el localId (PuntoDeVenta.localId es
// NOT NULL) antes de persistir — el filtro del motor y el índice usan
// origenLocalId para el caso "todo el local".
export async function resolverLocalIdOrigen(
  prisma: AperturaDbClient,
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null }
): Promise<{ origenLocalId: number | null; origenPuntoDeVentaId: number | null }> {
  if (origen.origenLocalId != null || origen.origenPuntoDeVentaId == null) return origen;
  const pdv = await prisma.puntoDeVenta.findUnique({
    where: { id: origen.origenPuntoDeVentaId },
    select: { localId: true },
  });
  return { ...origen, origenLocalId: pdv?.localId ?? null };
}
```

- [ ] **Step 2: `condicionComprasElegibles` — nuevo parámetro de origen**

Cambiar la firma y el WHERE. La cláusula de origen:

```typescript
export function condicionComprasElegibles(
  entidadId: string,
  vigenciaSql: Prisma.Sql,
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null },
  reglaEnEdicionId?: number | null
): Prisma.Sql {
  const filtroDistribuido =
    reglaEnEdicionId != null
      ? Prisma.sql`(c."esDistribuido" = false OR EXISTS (
          SELECT 1 FROM distribuciones_apertura da
          WHERE da."compraRowId" = c."rowId" AND da."reglaId" = ${reglaEnEdicionId}
        ))`
      : Prisma.sql`c."esDistribuido" = false`;

  // Origen: PDV puntual → solo ese PDV; solo local → todo el local. Una compra
  // sin localId/puntoDeVentaId nunca matchea (spec sección 4.1).
  const filtroOrigen =
    origen.origenPuntoDeVentaId != null
      ? Prisma.sql`c."puntoDeVentaId" = ${origen.origenPuntoDeVentaId}`
      : Prisma.sql`c."localId" = ${origen.origenLocalId}`;

  return Prisma.sql`
    SELECT c."rowId", COALESCE(c."importeManual", c.importe) AS "importeBase"
    FROM compras c
    WHERE COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${entidadId}
      AND c."esBloqueado" = false
      AND ${filtroDistribuido}
      AND ${filtroOrigen}
      AND COALESCE(c."importeManual", c.importe) IS NOT NULL
      AND (${vigenciaSql})
  `;
}
```

- [ ] **Step 3: `aplicarRegla` — pasar el origen**

En `AplicarReglaInput` agregar:

```typescript
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null };
```

En el cuerpo de `aplicarRegla`, cambiar la llamada:

```typescript
  const compras = await prisma.$queryRaw<{ rowId: string; importeBase: Prisma.Decimal }[]>(
    condicionComprasElegibles(input.entidadId, vigenciaSql, input.origen)
  );
```

- [ ] **Step 4: Verificar compilación (los callers rompen — se arreglan en Tasks 6/9/10)**

Run: `npx tsc --noEmit`
Expected: errores SOLO en los callers de `condicionComprasElegibles` / `aplicarRegla` (route handlers, `reimportacion.ts`, `preview-total`). Anotarlos; se resuelven en las tasks siguientes. Si hay error dentro de `motor.ts` mismo, corregir acá.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/motor.ts
git commit -m "feat(apertura): condicionComprasElegibles y aplicarRegla filtran por origen"
```

---

## Task 6: Motor — superposición acotada al origen

**Files:**
- Modify: `lib/apertura/motor.ts`

**Interfaces:**
- Consumes: `origenesSuperpuestos` (Task 2).
- Produces: `verificarSinSuperposicion(prisma, entidadId, vigenciaNueva, origenNuevo, excluirId?)` — nuevo 4º parámetro `origenNuevo: { localId: number | null; puntoDeVentaId: number | null }`.

- [ ] **Step 1: Modificar `verificarSinSuperposicion`**

```typescript
import { encontrarSuperposicion, origenesSuperpuestos } from "./validaciones";

export async function verificarSinSuperposicion(
  prisma: AperturaDbClient,
  entidadId: string,
  vigenciaNueva: ReglaVigencia,
  origenNuevo: { localId: number | null; puntoDeVentaId: number | null },
  excluirId?: number
): Promise<void> {
  const existentes = await prisma.reglaApertura.findMany({
    where: {
      entidadId,
      nivel: "concepto",
      estado: "activa",
      ...(excluirId != null ? { NOT: { id: excluirId } } : {}),
    },
    select: {
      id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true,
      origenLocalId: true, origenPuntoDeVentaId: true,
    },
  });

  // Solo chocan las reglas cuyo ORIGEN compite por la misma plata que el
  // nuevo — dos reglas del mismo concepto para PDV distintos pueden coexistir
  // con fechas solapadas (spec sección 5).
  const conOrigenSolapado = existentes.filter((r) =>
    origenesSuperpuestos(
      { localId: origenNuevo.localId, puntoDeVentaId: origenNuevo.puntoDeVentaId },
      { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId }
    )
  );

  const conflictoId = encontrarSuperposicion(
    vigenciaNueva,
    conOrigenSolapado.map((r) => ({
      id: r.id,
      modo: r.modo as ReglaVigencia["modo"],
      fechaDesde: r.fechaDesde,
      fechaHasta: r.fechaHasta,
      extremosInclusivos: r.extremosInclusivos,
    }))
  );
  if (conflictoId !== null) {
    throw new SuperposicionError(conflictoId);
  }
}
```

- [ ] **Step 2: Verificar compilación**

Run: `npx tsc --noEmit`
Expected: errores solo en los callers de `verificarSinSuperposicion` (los dos route handlers de reglas) — se arreglan en Task 10.

- [ ] **Step 3: Commit**

```bash
git add lib/apertura/motor.ts
git commit -m "feat(apertura): superposición de reglas acotada al origen solapado"
```

---

## Task 7: Motor — `aplicarReglaACompra` (distribución de una sola compra)

**Files:**
- Modify: `lib/apertura/motor.ts`
- Test: `lib/apertura/calculo.test.ts` (agrega un caso de invariante — la lógica de reparto ya vive en `calcularDistribuciones`)

**Interfaces:**
- Consumes: `calcularDistribuciones` (`./calculo`), `DestinoPct`.
- Produces: `aplicarReglaACompra(prisma, input: { reglaId: number; rowId: string; importeBase: number; destinos: DestinoPct[] }): Promise<void>` — inserta las distribuciones de esa compra y marca `esDistribuido = true`.

- [ ] **Step 1: Test del invariante (una sola compra)**

Agregar a `lib/apertura/calculo.test.ts`:

```typescript
it("una sola compra: la suma de distribuciones es exactamente el importe base (invariante spec)", () => {
  const destinos = [{ id: 1, porcentaje: 70 }, { id: 2, porcentaje: 10 }, { id: 3, porcentaje: 10 }, { id: 4, porcentaje: 10 }];
  const dist = calcularDistribuciones(105704.01, destinos);
  const suma = dist.reduce((acc, d) => acc + d.importeCalculado, 0);
  expect(Math.round(suma * 100) / 100).toBe(105704.01);
});
```

- [ ] **Step 2: Correr y verificar que pasa (la lógica ya existe) o falla si hay bug**

Run: `npx vitest run lib/apertura/calculo.test.ts`
Expected: PASS (documenta el invariante para el caso de 4 destinos que usa el tooltip). Si FALLA, es un bug preexistente en `calcularDistribuciones` — PARAR y avisar.

- [ ] **Step 3: Implementar `aplicarReglaACompra` en `lib/apertura/motor.ts`**

Después de `aplicarRegla`:

```typescript
// Distribuye UNA sola compra según una regla ya resuelta — hermano acotado de
// aplicarRegla, usado por reevaluarCompra (lib/apertura/reevaluacion.ts) tras
// una edición manual. No corre el WHERE de condicionComprasElegibles: el
// caller ya decidió que esta compra concreta cae en la regla. Siempre dentro
// de $transaction (igual que el resto del motor).
export async function aplicarReglaACompra(
  prisma: AperturaDbClient,
  input: { reglaId: number; rowId: string; importeBase: number; destinos: DestinoPct[] }
): Promise<void> {
  const importeBase = Math.round(input.importeBase * 100) / 100;
  const distribuciones = calcularDistribuciones(importeBase, input.destinos);
  const porcentajePorDestino = new Map(input.destinos.map((d) => [d.id, d.porcentaje]));

  const filas = distribuciones.map(
    (d) => Prisma.sql`(
      ${input.rowId}, ${input.reglaId}, ${d.destinoId},
      ${importeBase}::numeric, ${porcentajePorDestino.get(d.destinoId)}::numeric,
      ${d.importeCalculado}::numeric
    )`
  );

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO distribuciones_apertura
      ("compraRowId", "reglaId", "destinoId", "importeOriginal", porcentaje, "importeCalculado")
    VALUES ${Prisma.join(filas)}
  `);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras SET "esDistribuido" = true, "distribuidoEn" = now() WHERE "rowId" = ${input.rowId}
  `);
}
```

- [ ] **Step 4: Verificar compilación**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `motor.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/motor.ts lib/apertura/calculo.test.ts
git commit -m "feat(apertura): aplicarReglaACompra distribuye una sola compra"
```

---

## Task 8: `reevaluacion.ts` — `elegirReglaParaCompra` (pura) + `reevaluarCompra` (orquestación)

**Files:**
- Create: `lib/apertura/reevaluacion.ts`
- Create: `lib/apertura/reevaluacion.test.ts`

**Interfaces:**
- Consumes: `origenAlcanza` (Task 2), `fechaEnVigencia` (Task 3), `revertirCompra` + `aplicarReglaACompra` (`motor.ts`), `ReglaVigencia`.
- Produces:
  - `elegirReglaParaCompra(ubicacion, fechaEfectiva, reglas): ReglaCandidata | null` — pura.
  - `reevaluarCompra(prisma, rowId): Promise<{ reevaluada: boolean; distribuidaAhora: boolean }>` — orquestación (sin test unitario; cubierta por verificación manual, Task 17).
  - tipo `ReglaCandidata` = `{ id: number; modo: ...; fechaDesde: Date | null; fechaHasta: Date | null; extremosInclusivos: boolean; origenLocalId: number | null; origenPuntoDeVentaId: number | null; destinos: { id: number; porcentaje: number }[] }`.

- [ ] **Step 1: Escribir los tests que fallan (solo la parte pura)**

`lib/apertura/reevaluacion.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { elegirReglaParaCompra, type ReglaCandidata } from "./reevaluacion";

const reglaRamosAlquiler: ReglaCandidata = {
  id: 1, modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true,
  origenLocalId: 1, origenPuntoDeVentaId: 10, destinos: [{ id: 100, porcentaje: 100 }],
};
const reglaSanJustoEne: ReglaCandidata = {
  id: 2, modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-01-31"), extremosInclusivos: true,
  origenLocalId: 2, origenPuntoDeVentaId: null, destinos: [{ id: 200, porcentaje: 100 }],
};

describe("elegirReglaParaCompra", () => {
  it("elige la regla cuyo origen alcanza la compra y cuya vigencia cubre la fecha", () => {
    const r = elegirReglaParaCompra({ localId: 1, puntoDeVentaId: 10 }, new Date("2026-05-01"), [reglaRamosAlquiler, reglaSanJustoEne]);
    expect(r?.id).toBe(1);
  });
  it("no elige una regla de otro origen", () => {
    const r = elegirReglaParaCompra({ localId: 2, puntoDeVentaId: 20 }, new Date("2026-05-01"), [reglaRamosAlquiler]);
    expect(r).toBeNull();
  });
  it("no elige una regla cuya vigencia no cubre la fecha", () => {
    const r = elegirReglaParaCompra({ localId: 2, puntoDeVentaId: 20 }, new Date("2026-05-01"), [reglaSanJustoEne]);
    expect(r).toBeNull();
  });
  it("compra sin local: ninguna regla", () => {
    const r = elegirReglaParaCompra({ localId: null, puntoDeVentaId: null }, new Date("2026-01-15"), [reglaRamosAlquiler, reglaSanJustoEne]);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/apertura/reevaluacion.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `lib/apertura/reevaluacion.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { origenAlcanza } from "./validaciones";
import { fechaEnVigencia, type ReglaVigencia } from "./vigencia";
import { revertirCompra, aplicarReglaACompra, type AperturaDbClient } from "./motor";

export type ReglaCandidata = {
  id: number;
  modo: ReglaVigencia["modo"];
  fechaDesde: Date | null;
  fechaHasta: Date | null;
  extremosInclusivos: boolean;
  origenLocalId: number | null;
  origenPuntoDeVentaId: number | null;
  destinos: { id: number; porcentaje: number }[];
};

// Pura: entre las reglas activas del concepto efectivo de una compra, elige la
// que la cubre (origen alcanza su ubicación + vigencia cubre su fecha). Por el
// invariante de no-superposición hay a lo sumo una; si hubiera varias, gana la
// primera (orden del caller) — mismo criterio determinístico que
// encontrarSuperposicion.
export function elegirReglaParaCompra(
  ubicacion: { localId: number | null; puntoDeVentaId: number | null },
  fechaEfectiva: Date,
  reglas: ReglaCandidata[]
): ReglaCandidata | null {
  return (
    reglas.find(
      (r) =>
        origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          ubicacion
        ) &&
        fechaEnVigencia(fechaEfectiva, {
          modo: r.modo,
          fechaDesde: r.fechaDesde,
          fechaHasta: r.fechaHasta,
          extremosInclusivos: r.extremosInclusivos,
        })
    ) ?? null
  );
}

// Orquestación: revierte la distribución vieja de la compra y le aplica la
// regla activa que corresponda a su estado ACTUAL (concepto/fecha/local
// efectivos). SIEMPRE dentro de una $transaction (igual que el resto del
// motor). Devuelve si se reevaluó y si quedó distribuida.
export async function reevaluarCompra(
  prisma: AperturaDbClient,
  rowId: string
): Promise<{ reevaluada: boolean; distribuidaAhora: boolean }> {
  const compra = await prisma.compra.findUnique({
    where: { rowId },
    select: {
      localId: true, puntoDeVentaId: true,
      fecha: true, fechaManual: true,
      importe: true, importeManual: true,
      conceptoCodigo: true, conceptoCodigoManual: true,
    },
  });
  if (!compra) return { reevaluada: false, distribuidaAhora: false };

  await revertirCompra(prisma, rowId);

  const conceptoEfectivo = compra.conceptoCodigoManual ?? compra.conceptoCodigo;
  const fechaEfectiva = compra.fechaManual ?? compra.fecha;
  const importeEfectivo = compra.importeManual ?? compra.importe;
  if (!conceptoEfectivo || !fechaEfectiva || importeEfectivo == null) {
    return { reevaluada: true, distribuidaAhora: false };
  }

  const candidatas = await prisma.reglaApertura.findMany({
    where: { estado: "activa", nivel: "concepto", entidadId: conceptoEfectivo },
    select: {
      id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true,
      origenLocalId: true, origenPuntoDeVentaId: true,
      destinos: { select: { id: true, porcentaje: true } },
    },
  });

  const regla = elegirReglaParaCompra(
    { localId: compra.localId, puntoDeVentaId: compra.puntoDeVentaId },
    fechaEfectiva,
    candidatas.map((r) => ({
      id: r.id,
      modo: r.modo as ReglaVigencia["modo"],
      fechaDesde: r.fechaDesde,
      fechaHasta: r.fechaHasta,
      extremosInclusivos: r.extremosInclusivos,
      origenLocalId: r.origenLocalId,
      origenPuntoDeVentaId: r.origenPuntoDeVentaId,
      destinos: r.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
    }))
  );
  if (!regla) return { reevaluada: true, distribuidaAhora: false };

  await aplicarReglaACompra(prisma, {
    reglaId: regla.id,
    rowId,
    importeBase: Math.round(Number(importeEfectivo.toString()) * 100) / 100,
    destinos: regla.destinos,
  });
  return { reevaluada: true, distribuidaAhora: true };
}
```

Si `AperturaDbClient` no está exportado desde `motor.ts`, ya lo está (línea 11). Verificar el import.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/apertura/reevaluacion.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar compilación**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `lib/apertura/`.

- [ ] **Step 6: Commit**

```bash
git add lib/apertura/reevaluacion.ts lib/apertura/reevaluacion.test.ts
git commit -m "feat(apertura): reevaluacion.ts — recalcula la distribución de una compra editada"
```

---

## Task 9: DTO de la regla + wiring de `reimportacion.ts`

**Files:**
- Modify: `lib/apertura/types.ts`
- Modify: `lib/apertura/reimportacion.ts`

**Interfaces:**
- Produces: `ReglaAperturaDTO` suma `origenLocalId: number | null` + `origenPuntoDeVentaId: number | null`.
- Consumes: `aplicarRegla` con `origen` (Task 5).

- [ ] **Step 1: `lib/apertura/types.ts`**

En `ReglaAperturaDTO`, después de `entidadId: string;`:

```typescript
  origenLocalId: number | null;
  origenPuntoDeVentaId: number | null;
```

- [ ] **Step 2: `lib/apertura/reimportacion.ts` — pasar el origen a `aplicarRegla`**

En el `findMany` de `reglasActivas` ya se usa `include: { destinos: true }`, que trae los campos escalares nuevos automáticamente. En la llamada a `aplicarRegla` dentro del loop, agregar:

```typescript
          await aplicarRegla(tx, {
            reglaId: regla.id,
            entidadId: regla.entidadId,
            vigencia,
            origen: { origenLocalId: regla.origenLocalId, origenPuntoDeVentaId: regla.origenPuntoDeVentaId },
            destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
          });
```

- [ ] **Step 3: Verificar compilación**

Run: `npx tsc --noEmit`
Expected: `reimportacion.ts` ya no rompe. Siguen rotos: los 3 route handlers de apertura + `preview-total` (Task 10).

- [ ] **Step 4: Commit**

```bash
git add lib/apertura/types.ts lib/apertura/reimportacion.ts
git commit -m "feat(apertura): DTO con origen + reimportacion pasa origen a aplicarRegla"
```

---

## Task 10: Route handlers de reglas — persistir y filtrar por origen

**Files:**
- Modify: `app/api/apertura/reglas/route.ts` (POST + GET)
- Modify: `app/api/apertura/reglas/[id]/route.ts` (PATCH, rama editar)
- Modify: `app/api/apertura/reglas/preview-total/route.ts`

**Interfaces:**
- Consumes: `crearReglaSchema` / `patchReglaSchema` / `previewTotalQuerySchema` con origen (Task 4); `verificarSinSuperposicion` (Task 6); `aplicarRegla` con `origen` (Task 5); `resolverLocalIdOrigen` (Task 5); `condicionComprasElegibles` con `origen` (Task 5).

- [ ] **Step 1: `POST /api/apertura/reglas`**

Tras `const { entidadId, modo, ... , destinos } = parsed.data;` agregar `origenLocalId`, `origenPuntoDeVentaId`.

Dentro del `$transaction`, antes de `verificarSinSuperposicion`, resolver el origen:

```typescript
        const origen = await resolverLocalIdOrigen(tx, {
          origenLocalId: origenLocalId ?? null,
          origenPuntoDeVentaId: origenPuntoDeVentaId ?? null,
        });

        await verificarSinSuperposicion(tx, entidadId, vigenciaNueva, {
          localId: origen.origenLocalId,
          puntoDeVentaId: origen.origenPuntoDeVentaId,
        });
```

En `tx.reglaApertura.create({ data: { ... } })` agregar `origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId`.

En la llamada a `aplicarRegla` agregar `origen: { origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId }`.

Import: agregar `resolverLocalIdOrigen` a la lista desde `@/lib/apertura/motor`.

- [ ] **Step 2: `GET /api/apertura/reglas`**

El `findMany` con `include: { destinos: true }` ya trae los escalares nuevos. Sin cambio de código; verificar que la respuesta serializa `origenLocalId` / `origenPuntoDeVentaId` (lo hace — son columnas escalares).

- [ ] **Step 3: `PATCH /api/apertura/reglas/[id]` (rama editar)**

Tras `const { modo, ..., destinos } = parsed.data;` agregar `origenLocalId`, `origenPuntoDeVentaId`.

Dentro del `$transaction`:

```typescript
        const origen = await resolverLocalIdOrigen(tx, {
          origenLocalId: origenLocalId ?? null,
          origenPuntoDeVentaId: origenPuntoDeVentaId ?? null,
        });

        await verificarSinSuperposicion(tx, existente.entidadId, vigenciaNueva, {
          localId: origen.origenLocalId,
          puntoDeVentaId: origen.origenPuntoDeVentaId,
        }, id);
```

En `tx.reglaApertura.update({ data: { ... } })` agregar `origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId`.

En `aplicarRegla` agregar `origen: { origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId }`.

Import `resolverLocalIdOrigen`.

- [ ] **Step 4: `GET /api/apertura/reglas/preview-total`**

Tras el `safeParse` exitoso, extraer `origenLocalId`, `origenPuntoDeVentaId` de `parsed.data` y pasarlos a `condicionComprasElegibles`. Ubicar la llamada actual (dentro del `$queryRaw` que suma el total) y cambiarla a:

```typescript
    condicionComprasElegibles(
      entidadId,
      vigenciaSql,
      { origenLocalId: origenLocalId ?? null, origenPuntoDeVentaId: origenPuntoDeVentaId ?? null },
      reglaId ?? null
    )
```

(el 4º arg `reglaEnEdicionId` pasa de 3ª a 4ª posición — verificar el orden en el archivo).

- [ ] **Step 5: Verificar compilación y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 6: Correr toda la suite de apertura**

Run: `npx vitest run lib/apertura/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/apertura
git commit -m "feat(apertura): endpoints de reglas persisten y previsualizan por origen"
```

---

## Task 11: `PATCH /api/dashboard/compras/[rowId]` — reevaluar en vez de bloquear

**Files:**
- Modify: `app/api/dashboard/compras/[rowId]/route.ts`

**Interfaces:**
- Consumes: `reevaluarCompra` (Task 8).
- Produces: respuesta JSON del PATCH suma `{ reevaluada: boolean; distribuidaAhora: boolean }`.

- [ ] **Step 1: Reescribir el handler**

Quitar el guard 409 (`if (compra.esDistribuido) { return ... 409 }`). Nuevo cuerpo, desde la validación en adelante:

```typescript
  const { importeManual, fechaManual, conceptoCodigoManual, observacManual } = parsed.data;

  const compra = await prisma.compra.findUnique({ where: { rowId }, select: { rowId: true } });
  if (!compra) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });

  // Solo un cambio en un campo que afecta el matching de reglas dispara la
  // reevaluación — observacManual no cambia a qué regla pertenece la compra.
  const afectaMatching =
    importeManual !== undefined || fechaManual !== undefined || conceptoCodigoManual !== undefined;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.compra.update({
        where: { rowId },
        data: {
          ...(importeManual !== undefined && { importeManual }),
          ...(fechaManual !== undefined && { fechaManual: fechaManual !== null ? new Date(fechaManual) : null }),
          ...(conceptoCodigoManual !== undefined && { conceptoCodigoManual }),
          ...(observacManual !== undefined && { observacManual }),
        },
        select: { rowId: true, importeManual: true, fechaManual: true, conceptoCodigoManual: true, observacManual: true },
      });

      const reeval = afectaMatching
        ? await reevaluarCompra(tx, rowId)
        : { reevaluada: false, distribuidaAhora: false };

      return { updated, reeval };
    });

    return NextResponse.json({ ...result.updated, ...result.reeval });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
      if (err.code === "P2003") return NextResponse.json({ error: "Concepto no encontrado" }, { status: 404 });
    }
    console.error("[PATCH /api/dashboard/compras/[rowId]]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
```

Import: `import { reevaluarCompra } from "@/lib/apertura/reevaluacion";`. Agregar `export const maxDuration = 60;` (la reevaluación corre motor dentro de la request — mismo criterio que los endpoints de reglas).

- [ ] **Step 2: Verificar compilación y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add app/api/dashboard/compras
git commit -m "feat(apertura): editar una compra reevalúa sus reglas de apertura (saca guard 409)"
```

---

## Task 12: `buildComposicion` — función pura del tooltip

**Files:**
- Create: `lib/dashboard/apertura-composicion.ts`
- Create: `lib/dashboard/apertura-composicion.test.ts`
- Modify: `lib/dashboard/types.ts`

**Interfaces:**
- Produces:
  - tipo `ComposicionMes = { total: number; destinos: { nombre: string; pct: number; importe: number }[] }`
  - tipo `ComposicionSqlRow = { concepto_codigo: string; mes: number; destino_nombre: string; pct: number | string | { toString(): string }; importe_calculado: number | string | { toString(): string } }`
  - tipo `ComposicionOriginalRow = { concepto_codigo: string; mes: number; importe_original: number | string | { toString(): string } }`
  - `buildComposicion(destinoRows: ComposicionSqlRow[], originalRows: ComposicionOriginalRow[]): Record<string, Record<number, ComposicionMes>>`
  - `PivotConceptoRow` suma `composicion?: Record<number, ComposicionMes>`

- [ ] **Step 1: Tipos en `lib/dashboard/types.ts`**

Agregar (cerca de `PivotConceptoRow`):

```typescript
export type ComposicionMes = {
  total: number;
  destinos: { nombre: string; pct: number; importe: number }[];
};
```

En `PivotConceptoRow`, agregar campo opcional:

```typescript
  composicion?: Record<number, ComposicionMes>;
```

- [ ] **Step 2: Test que falla**

`lib/dashboard/apertura-composicion.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildComposicion } from "./apertura-composicion";

describe("buildComposicion", () => {
  it("agrupa por concepto+mes y arma la lista de destinos con pct e importe", () => {
    const destinoRows = [
      { concepto_codigo: "17", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 73993 },
      { concepto_codigo: "17", mes: 5, destino_nombre: "Canchas Ramos", pct: 10, importe_calculado: 10570 },
      { concepto_codigo: "17", mes: 5, destino_nombre: "Canchas SJ", pct: 10, importe_calculado: 10570 },
      { concepto_codigo: "17", mes: 5, destino_nombre: "Descartado", pct: 10, importe_calculado: 10571 },
    ];
    const originalRows = [{ concepto_codigo: "17", mes: 5, importe_original: 105704 }];
    const result = buildComposicion(destinoRows, originalRows);
    expect(result["17"][5].total).toBe(105704);
    expect(result["17"][5].destinos).toHaveLength(4);
    expect(result["17"][5].destinos[0]).toEqual({ nombre: "Actual", pct: 70, importe: 73993 });
  });

  it("convierte Decimal-like (string) a number", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "3", mes: 1, destino_nombre: "X", pct: "50.00", importe_calculado: "1000.00" }],
      [{ concepto_codigo: "3", mes: 1, importe_original: "2000.00" }]
    );
    expect(result["3"][1].destinos[0]).toEqual({ nombre: "X", pct: 50, importe: 1000 });
    expect(result["3"][1].total).toBe(2000);
  });

  it("concepto+mes sin fila de original: total 0 (no rompe)", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "9", mes: 2, destino_nombre: "X", pct: 100, importe_calculado: 5 }],
      []
    );
    expect(result["9"][2].total).toBe(0);
  });
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npx vitest run lib/dashboard/apertura-composicion.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 4: Implementar `lib/dashboard/apertura-composicion.ts`**

```typescript
import type { ComposicionMes } from "./types";

type DecimalLike = number | string | { toString(): string };
const toNum = (x: DecimalLike): number =>
  typeof x === "object" && x !== null ? Number(x.toString()) : Number(x);

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
    ensure(row.concepto_codigo, row.mes).destinos.push({
      nombre: row.destino_nombre,
      pct: toNum(row.pct),
      importe: toNum(row.importe_calculado),
    });
  }
  return out;
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run lib/dashboard/apertura-composicion.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/apertura-composicion.ts lib/dashboard/apertura-composicion.test.ts lib/dashboard/types.ts
git commit -m "feat(dashboard): buildComposicion — mapa concepto/mes/destino para el tooltip de apertura"
```

---

## Task 13: `pivot/route.ts` — segundo query de composición

**Files:**
- Modify: `app/api/dashboard/pivot/route.ts`

**Interfaces:**
- Consumes: `buildComposicion` (Task 12), `buildPivotConditions` (ya usado).
- Produces: cada `PivotConceptoRow` de la respuesta trae `composicion` cuando el concepto tiene distribuciones visibles.

- [ ] **Step 1: Segundo `$queryRaw` tras el `rows` principal**

Después del `const rows = await prisma.$queryRaw<SqlRow[]>(...)` existente, agregar dos queries acotadas por las mismas `conditions`. La clave: el `WHERE` debe usar el **mismo** `where` (mismas `conditions`) pero sobre `v_compras_distribuidas` filtrando solo la rama distribuida (`c."distribucionId" IS NOT NULL`).

```typescript
  // Composición para el tooltip: por concepto efectivo + mes + destino.
  const composicionDestinos = await prisma.$queryRaw<import("@/lib/dashboard/apertura-composicion").ComposicionSqlRow[]>(Prisma.sql`
    SELECT
      COALESCE(cc.codigo, '__sin_concepto')                        AS concepto_codigo,
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int  AS mes,
      COALESCE(pv.nombre, l.nombre, 'Sin destino')                 AS destino_nombre,
      da.porcentaje                                                AS pct,
      SUM(da."importeCalculado")                                   AS importe_calculado
    FROM v_compras_distribuidas c
    JOIN distribuciones_apertura da   ON da.id = c."distribucionId"
    JOIN destinos_regla dr            ON dr.id = da."destinoId"
    LEFT JOIN locales l               ON l.id = dr."localId"
    LEFT JOIN puntos_de_venta pv      ON pv.id = dr."puntoDeVentaId"
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId" = p.id
    WHERE c."distribucionId" IS NOT NULL AND ${where}
    GROUP BY concepto_codigo, mes, destino_nombre, da.porcentaje
  `);

  // Total "100%" = importe original, deduplicado por compra (en el fan-out el
  // importeOriginal está repetido en cada fila de destino de la misma compra).
  const composicionOriginales = await prisma.$queryRaw<import("@/lib/dashboard/apertura-composicion").ComposicionOriginalRow[]>(Prisma.sql`
    SELECT concepto_codigo, mes, SUM(importe_original) AS importe_original
    FROM (
      SELECT DISTINCT
        COALESCE(cc.codigo, '__sin_concepto')                       AS concepto_codigo,
        EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
        da."compraRowId",
        da."importeOriginal"                                        AS importe_original
      FROM v_compras_distribuidas c
      JOIN distribuciones_apertura da   ON da.id = c."distribucionId"
      LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
      LEFT JOIN proveedores p           ON c."proveedorId" = p.id
      WHERE c."distribucionId" IS NOT NULL AND ${where}
    ) dedup
    GROUP BY concepto_codigo, mes
  `);
```

Nota: `${where}` referencia `c."..."` — las columnas que `buildPivotConditions` usa (`localId`, `puntoDeVentaId`, fecha, concepto, proveedor, observac) existen todas en `v_compras_distribuidas`, así que la condición aplica igual. Los `LEFT JOIN` a `rc` y `p` están porque `buildPivotConditions` puede referenciar `rc.codigo` (filtro de rubro) y `p.id` (filtro de proveedor) — copiar los mismos JOIN que usa el query principal para que `${where}` resuelva.

- [ ] **Step 2: Construir el mapa y pasarlo a `buildPivotData`**

```typescript
  const composicion = buildComposicion(composicionDestinos, composicionOriginales);
  return NextResponse.json(buildPivotData(rows, composicion));
```

Cambiar la firma de `buildPivotData(sqlRows: SqlRow[], composicion: Record<string, Record<number, ComposicionMes>>)` y, donde se crea cada `PivotConceptoRow` (el bloque `if (!conceptoMap.has(concKey))`), agregar:

```typescript
        composicion: composicion[concepto_codigo],
```

Imports: `import { buildComposicion } from "@/lib/dashboard/apertura-composicion";` y `import type { ComposicionMes } from "@/lib/dashboard/types";` (o reusar el ya presente import de types).

- [ ] **Step 3: Verificar compilación y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 4: Verificación manual del endpoint**

Run: `npm run dev`, y con una regla activa creada (origen + destinos) sobre un concepto con compras, pegar:
`curl -s 'http://localhost:3000/api/dashboard/pivot?year=2026' -H 'Cookie: <sesión>' | jq '.rows[].children[] | select(.composicion) | .composicion'`
Expected: objeto `{ "<mes>": { total, destinos: [...] } }` con la suma de `destinos[].importe` ≈ `total`.

(Si no es práctico curl con sesión, diferir a la verificación integral de la Task 17.)

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard/pivot/route.ts
git commit -m "feat(dashboard): pivot emite la composición por destino de los conceptos aperturados"
```

---

## Task 14: `AperturaOrigenSelector` + wiring en el modal

**Files:**
- Create: `components/dashboard/apertura-origen-selector.tsx`
- Modify: `components/dashboard/apertura-gastos-modal.tsx`

**Interfaces:**
- Consumes: `Local` (`@/lib/types/domain`), `Select`/`SelectItem` de shadcn.
- Produces:
  - `OrigenFormState = { localId: number | null; puntoDeVentaId: number | null }`
  - `<AperturaOrigenSelector value={OrigenFormState} locales={Local[]} onChange={(next) => void} />`
  - El modal manda `origenLocalId` / `origenPuntoDeVentaId` en el body de POST/PATCH y en la query de preview.

- [ ] **Step 1: Crear `components/dashboard/apertura-origen-selector.tsx`**

```tsx
"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Local } from "@/lib/types/domain";

export interface OrigenFormState {
  localId: number | null;
  puntoDeVentaId: number | null;
}

const TODO_EL_LOCAL = "__todo_el_local";

export function AperturaOrigenSelector({
  value,
  locales,
  onChange,
}: {
  value: OrigenFormState;
  locales: Local[];
  onChange: (next: OrigenFormState) => void;
}) {
  const localSeleccionado = locales.find((l) => l.id === value.localId);
  const puntosDeVenta = localSeleccionado?.puntosDeVenta ?? [];

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted-foreground">Origen de la regla</label>
      <div className="flex gap-2">
        <Select
          value={value.localId != null ? String(value.localId) : ""}
          onValueChange={(v) => onChange({ localId: Number(v), puntoDeVentaId: null })}
        >
          <SelectTrigger className="flex-1"><SelectValue placeholder="Local" /></SelectTrigger>
          <SelectContent>
            {locales.map((l) => (
              <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.puntoDeVentaId != null ? String(value.puntoDeVentaId) : TODO_EL_LOCAL}
          disabled={value.localId == null}
          onValueChange={(v) =>
            onChange({ ...value, puntoDeVentaId: v === TODO_EL_LOCAL ? null : Number(v) })
          }
        >
          <SelectTrigger className="flex-1"><SelectValue placeholder="Punto de venta" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODO_EL_LOCAL}>Todo el local</SelectItem>
            {puntosDeVenta.map((pv) => (
              <SelectItem key={pv.id} value={String(pv.id)}>{pv.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Estado `origen` en el modal**

En `apertura-gastos-modal.tsx`:
- Import `AperturaOrigenSelector, type OrigenFormState`.
- `const ORIGEN_VACIO: OrigenFormState = { localId: null, puntoDeVentaId: null };`
- `const [origen, setOrigen] = useState<OrigenFormState>(ORIGEN_VACIO);`
- En `abrirFormularioNuevo`: `setOrigen(ORIGEN_VACIO);`
- En `abrirFormularioEditar(regla)`: `setOrigen({ localId: regla.origenLocalId, puntoDeVentaId: regla.origenPuntoDeVentaId });`
- En `reglaAFormulario` no hace falta tocar (el origen se setea aparte).

- [ ] **Step 3: Render del selector + gating de Guardar**

En el bloque `view === "formulario"`, antes de `<AperturaVigenciaSelector .../>`:

```tsx
              <AperturaOrigenSelector value={origen} locales={locales} onChange={setOrigen} />
```

`const origenCompleto = origen.localId != null;`

En el `disabled` del botón Guardar agregar `|| !origenCompleto`. En la lista de "Falta:" agregar:

```tsx
                    if (!origenCompleto) motivos.push("elegí el origen de la regla");
```

- [ ] **Step 4: Mandar el origen en preview y en guardar**

En `previewUrl` (el `URLSearchParams`), agregar cuando `origenCompleto`:

```tsx
        ...(origen.localId != null ? { origenLocalId: String(origen.localId) } : {}),
        ...(origen.puntoDeVentaId != null ? { origenPuntoDeVentaId: String(origen.puntoDeVentaId) } : {}),
```

y condicionar `vigenciaCompletaParaPreview` (o crear `previewUrl`) también a `origenCompleto`.

En la key de `useFetchQuery(["apertura-preview-total", ...])` agregar `origen.localId, origen.puntoDeVentaId`.

En `cuerpoComun` (dentro de `handleGuardar`) agregar:

```tsx
        origenLocalId: origen.localId,
        origenPuntoDeVentaId: origen.puntoDeVentaId,
```

- [ ] **Step 5: Línea de origen en las cards de la lista**

Necesita nombres legibles. Agregar helper dentro del componente:

```tsx
  function resumenOrigen(regla: ReglaAperturaDTO): string {
    const local = locales.find((l) => l.id === regla.origenLocalId);
    if (regla.origenPuntoDeVentaId != null) {
      const pv = local?.puntosDeVenta.find((p) => p.id === regla.origenPuntoDeVentaId);
      return `Origen: ${pv?.nombre ?? "PDV"}`;
    }
    return `Origen: ${local?.nombre ?? "Local"} (todo el local)`;
  }
```

En la card, junto a `resumenVigencia(regla)`:

```tsx
                      <span className="text-xs text-muted-foreground truncate">{resumenOrigen(regla)}</span>
```

- [ ] **Step 6: Verificar compilación y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/apertura-origen-selector.tsx components/dashboard/apertura-gastos-modal.tsx
git commit -m "feat(apertura): selector de origen en el modal de reglas"
```

---

## Task 15: Timeline filtrada por origen + indicador del concepto sensible al filtro + tooltip

**Files:**
- Modify: `components/dashboard/apertura-timeline.tsx` (o el punto donde el modal arma `reglasParaTimeline`)
- Modify: `components/dashboard/pivot-table.tsx`

**Interfaces:**
- Consumes: `origenesSuperpuestos`, `origenAlcanza` (`@/lib/apertura/validaciones`); `useDashboard()` (`localId`, `pdvId`); `PivotConceptoRow.composicion`; `Tooltip` de `@/components/ui/tooltip`.

- [ ] **Step 1: Timeline — filtrar por origen solapado**

En `apertura-gastos-modal.tsx`, donde se arma `reglasParaTimeline` a partir de `reglasDelConcepto`, filtrar además por origen solapado con el del formulario (solo cuando `origen.localId != null`):

```tsx
    ...reglasDelConcepto
      .filter((r) => editando === null || r.id !== editando.id)
      .filter((r) =>
        origen.localId == null ||
        origenesSuperpuestos(
          { localId: origen.localId, puntoDeVentaId: origen.puntoDeVentaId },
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId }
        )
      )
      .map((r) => ({ /* ...igual que hoy... */ })),
```

Import `origenesSuperpuestos` de `@/lib/apertura/validaciones`.

- [ ] **Step 2: Indicador del concepto — considerar `localId`/`pdvId`**

En `pivot-table.tsx`, reemplazar `conceptosConReglaActiva`:

```tsx
  const { reglas } = useReglasApertura();
  const conceptosConReglaActiva = useMemo(() => {
    const activas = reglas.filter((r) => r.estado === "activa");
    const alcanzaFiltro = (r: (typeof activas)[number]) => {
      if (pdvId == null && localId == null) return true;
      return origenAlcanza(
        { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
        { localId: localId ?? null, puntoDeVentaId: pdvId ?? null }
      );
    };
    return new Set(activas.filter(alcanzaFiltro).map((r) => r.entidadId));
  }, [reglas, localId, pdvId]);
```

Nota: cuando hay solo `localId` (sin `pdvId`), `origenAlcanza` con `ubicacion.puntoDeVentaId = null` da true si la regla es "todo el local" de ese local, y false si la regla es un PDV puntual — que es lo correcto (spec sección 7: "regla cuyo origen cae dentro de ese local" incluye reglas de PDV de ese local). **Ajuste:** para el caso "solo localId seteado" el criterio es "el origen de la regla cae dentro del local", no "alcanza esa ubicación". Usar:

```tsx
    const alcanzaFiltro = (r) => {
      if (pdvId == null && localId == null) return true;
      if (pdvId != null) {
        return origenAlcanza({ localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId }, { localId: localId ?? r.origenLocalId, puntoDeVentaId: pdvId });
      }
      return r.origenLocalId === localId; // solo local seleccionado
    };
```

Import `origenAlcanza` de `@/lib/apertura/validaciones`.

- [ ] **Step 3: Tooltip de composición en la celda del concepto**

En `pivot-table.tsx`, import:

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

En el `months.map((mes) => ...)` del bloque `item.type === "concepto"`, envolver el contenido de la celda:

```tsx
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
                              <div key={i} className="text-muted-foreground">
                                {d.pct}% {d.nombre} {fmtARS(d.importe)}
                              </div>
                            ))}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
```

(Verificar que exista un `TooltipProvider` en el árbol — `compras-detalle-modal.tsx` ya usa `Tooltip` sin provider local, así que hay uno global; si no, envolver la tabla en `<TooltipProvider>`.)

- [ ] **Step 4: Verificar compilación y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/apertura-timeline.tsx components/dashboard/apertura-gastos-modal.tsx components/dashboard/pivot-table.tsx
git commit -m "feat(apertura): timeline e indicador por origen + tooltip de composición"
```

---

## Task 16: `compras-detalle-modal` — habilitar edición de distribuidas + ConfirmDialog

**Files:**
- Modify: `components/dashboard/compras-detalle-modal.tsx`

**Interfaces:**
- Consumes: respuesta del PATCH con `{ reevaluada, distribuidaAhora }` (Task 11); `ConfirmDialog` (`@/components/ui/confirm-dialog`); `conceptosConReglaActiva` no está acá — usar `useReglasApertura` para saber si el concepto nuevo tiene regla activa.

- [ ] **Step 1: Habilitar el lápiz en filas distribuidas**

En el `<td>` de acción (hoy `item.distribucionId == null && !item.esDistribuido ? <EditTriggerButton> : <Tooltip>…deshabilitado`), quitar la condición: siempre renderizar `<EditTriggerButton>`. El `onEdit` apunta a `String(item.rowId)` (ya lo hace). Para las filas fan-out (`distribucionId != null`) el `rowId` es el de la compra base — correcto.

Igual criterio en el `<td>` del detalle por líneas: dejarlo como está (la edición de líneas sigue no disponible para distribuidas — es otro feature).

- [ ] **Step 2: Estado del ConfirmDialog**

```tsx
  const { reglas: reglasApertura } = useReglasApertura();
  const [pendienteConfirmacion, setPendienteConfirmacion] = useState<EditState | null>(null);
```

Import `useReglasApertura` de `@/hooks/use-reglas-apertura` y `ConfirmDialog`.

- [ ] **Step 3: Interceptar el guardado**

Renombrar el `handleSave` actual a `guardarConfirmado` y crear un `handleSave` que decide si pedir confirmación:

```tsx
  const guardarRequiereConfirmacion = useCallback((state: EditState, item: CompraDetalle | undefined): boolean => {
    if (item?.esDistribuido || item?.distribucionId != null) return true;
    const conceptoNuevo = state.conceptoCodigoManual;
    return !!conceptoNuevo && reglasApertura.some((r) => r.estado === "activa" && r.entidadId === conceptoNuevo);
  }, [reglasApertura]);

  const handleSave = useCallback((state: EditState) => {
    // `itemsById` — el modal ya tiene la lista cargada; buscar el item por rowId.
    const item = (dataItems ?? []).find((d) => String(d.rowId) === state.rowId);
    if (guardarRequiereConfirmacion(state, item)) {
      setPendienteConfirmacion(state);
    } else {
      void guardarConfirmado(state);
    }
  }, [dataItems, guardarRequiereConfirmacion, guardarConfirmado]);
```

(`dataItems` = la lista que el `DetalleModalShell` ya tiene; si no está expuesta en este scope, pasar el `item` desde `renderRow` — `renderRow={(item) => <DetalleRow ... onSave={(state) => handleSave(state, item)} />}` y ajustar la firma. Elegir la variante que encaje con el código real.)

- [ ] **Step 4: Render del ConfirmDialog**

Antes del cierre del fragmento del componente:

```tsx
      <ConfirmDialog
        open={pendienteConfirmacion !== null}
        onOpenChange={(o) => { if (!o) setPendienteConfirmacion(null); }}
        title="Recalcular apertura de gastos"
        description="Esto va a recalcular la apertura de este registro según las reglas de apertura vigentes. ¿Confirmás?"
        confirmLabel="Confirmar y guardar"
        confirming={saving}
        onConfirm={async () => {
          const state = pendienteConfirmacion;
          setPendienteConfirmacion(null);
          if (state) await guardarConfirmado(state);
        }}
      />
```

- [ ] **Step 5: Toast según resultado + invalidaciones**

En `guardarConfirmado`, tras el guardado OK, leer el body:

```tsx
      const body = await res.json().catch(() => null);
      // ...
      await Promise.all([
        queryClient.refetchQueries({ queryKey }),
        queryClient.refetchQueries({ queryKey: ["pivot"] }),
        queryClient.invalidateQueries({ queryKey: ["apertura-reglas"] }),
      ]);
      notify.registroActualizado();
      if (body?.distribuidaAhora) notify.info?.("El registro quedó distribuido por una regla de apertura.");
```

(Usar el helper de toast que exista en `lib/toast.ts` para un mensaje informativo; si no hay `notify.info`, usar `notify.registroActualizado()` solo.)

- [ ] **Step 6: Verificar compilación y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/compras-detalle-modal.tsx
git commit -m "feat(apertura): editar una compra distribuida pide confirmación y recalcula"
```

---

## Task 17: Verificación integral

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: PASS, sin regresiones.

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: ambos OK.

- [ ] **Step 3: Verificación manual en dev (`npm run dev`)**

Seguir la spec sección 10.3:
1. Crear regla: concepto "Alquiler", **origen = PDV de Bar Ramos Mejía**, destino 100% a un local. Confirmar en el pivot filtrado por San Justo que "Alquiler" de San Justo **no** aparece distribuido / no cambió.
2. En el detalle de compras, editar una compra cuyo concepto sea "Alquiler de Herramientas" y cambiarlo a "Alquiler" (misma ubicación = ese PDV de Ramos). Verificar que aparece el `ConfirmDialog`; confirmar; verificar que la compra queda distribuida con los % de la regla.
3. Editar esa misma compra de vuelta a un concepto sin regla → `ConfirmDialog` → confirmar → queda sin distribuir.
4. En el pivot, hover sobre una celda mensual de "Alquiler" (concepto) → tooltip con `100% · $X` y una línea por destino; la suma de los importes de los destinos ≈ el total. Repetir con el dashboard filtrado por un local: el tooltip muestra la **composición completa** igual.
5. Crear una segunda regla para "Alquiler" con **origen = otro PDV** y fechas solapadas con la primera → debe **permitirlo**. Crear una tercera con el **mismo origen** y fechas solapadas → debe **bloquear con 409** y mensaje claro.

- [ ] **Step 4: `verification-before-completion`**

Invocar la skill `superpowers:verification-before-completion` y completar su checklist con la evidencia de los steps 1-3.

- [ ] **Step 5: Commit final (si quedaron ajustes)**

```bash
git add -A
git commit -m "test(apertura): verificación integral de los fixes de origen/tooltip/reevaluación"
```

---

## Self-Review

**Spec coverage:**
- Spec §1.1 / §8 (tooltip) → Tasks 12, 13, 15 (step 3). ✓
- Spec §1.2 / §3 (schema + migración) → Task 1. ✓
- Spec §4 (motor filtra por origen) → Tasks 5, 9 (reimportacion), 10 (preview). ✓
- Spec §5 (superposición por origen) → Tasks 2 (`origenesSuperpuestos`), 6. ✓
- Spec §6 (API + modal) → Tasks 4, 9, 10, 14. ✓
- Spec §7 (indicador por origen) → Task 15 step 2. ✓
- Spec §9 (reevaluación al editar) → Tasks 2 (`origenAlcanza`), 3 (`fechaEnVigencia`), 7 (`aplicarReglaACompra`), 8 (`reevaluacion.ts`), 11 (PATCH), 16 (UI + ConfirmDialog). ✓
- Spec §10 (testing) → Tasks 2-8, 12 tests; Task 17 manual. ✓
- Spec §11 (orden) → el orden de tasks lo respeta (migración primero, UI al final). ✓

**Placeholder scan:** sin "TBD"/"TODO"/"add error handling" genérico. Los puntos donde el código real puede diferir (nombre del índice viejo en Task 1 step 3; forma exacta de `dataItems` en Task 16 step 3; presencia de `TooltipProvider` en Task 15 step 3; helper de toast en Task 16 step 5) están marcados explícitamente con la alternativa a elegir.

**Type consistency:**
- `condicionComprasElegibles(entidadId, vigenciaSql, origen, reglaEnEdicionId?)` — firma nueva usada consistentemente en Tasks 5, 10 (preview).
- `origen` en `AplicarReglaInput` = `{ origenLocalId, origenPuntoDeVentaId }` — usado igual en Tasks 5, 9, 10.
- `verificarSinSuperposicion(..., origenNuevo: { localId, puntoDeVentaId }, excluirId?)` — Task 6 define, Task 10 consume con esa forma.
- `DestinoBasico` (`{ localId, puntoDeVentaId }`) — `origenesSuperpuestos` / `origenAlcanza` (Task 2) lo usan; el motor mapea `origenLocalId`→`localId` al llamar (Task 6). Consistente.
- `ComposicionMes` / `buildComposicion` — Task 12 define, Tasks 13 y 15 consumen.
- `{ reevaluada, distribuidaAhora }` — Task 8 produce, Tasks 11 y 16 consumen.
