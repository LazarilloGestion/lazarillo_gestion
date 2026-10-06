# "Sin Rubro" con visibilidad configurable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar este plan task por task (ejecución directa con el usuario presente — NO subagent-driven, ver CLAUDE.md §9.1 y §7). Steps con checkbox (`- [ ]`).

**Goal:** que el bucket sintético "Sin Rubro" se pueda prender/apagar por vista (Compras / Resultados) desde el modal "Rubros visibles", con default solo en Compras.

**Architecture:** "Sin Rubro" no es una fila de `rubros_concepto_caja` (son las compras con `rc.codigo IS NULL`), así que hoy `buildPivotConditions` lo deja siempre visible en ambas vistas (`OR rc.codigo IS NULL`). Se agrega una tabla de una sola fila `sin_rubro_config` con un booleano por vista; el builder SQL consulta esa fila; `GET/PATCH /api/config/rubros-dashboard` exponen "Sin Rubro" como un item más (`codigo: "__sin_rubro"`), así el modal no cambia.

**Tech Stack:** Next.js 16, Prisma 7 (adapter-pg), Zod, Vitest.

**Spec:** diseño aprobado en chat el 2026-10-06 (reporte "sin rubro se ve en ambos paneles"). Resumen de decisiones:
- Defaults: `visibleEnDashboard = true`, `visibleEnResultados = false` (igual que los rubros reales).
- Si la fila no existe, se asume el default (nunca ocultar en silencio).
- Sin filas centinela en `rubros_concepto_caja` (el ETL la upsertea y el LEFT JOIN nunca la matchea).
- Efecto conocido y aceptado: el Societario de Resultados (Ganancia) deja de incluir compras "Sin Rubro" con el default.

## Global Constraints

- Migración escrita a mano y aplicada con `npx prisma migrate deploy` — `migrate dev`/`db pull` están rotos (P4002, ver memoria `project_import_logs_deuda_migraciones`). NO reintentar arreglarlo acá.
- **Aplicar la migración requiere confirmación explícita del usuario** (CLAUDE.md §7). La migración es solo aditiva (tabla nueva + 1 fila), no toca compras/ventas.
- Nombres de columna interpolados en SQL solo vía whitelist `VISIBILIDAD_FIELDS`, nunca desde input crudo.
- Validación de body con Zod `safeParse` (ya existe `patchSchema`).
- Sin dependencias nuevas.
- Commits Conventional Commits; terminar el mensaje con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Correr `npm run lint` y `npm run build` al final; no cerrar con tests rotos.

---

## File Structure

- Modify: `prisma/schema.prisma` — modelo `SinRubroConfig`.
- Create: `prisma/migrations/20261006120000_sin_rubro_config/migration.sql`.
- Modify: `lib/dashboard/constants.ts` — `SIN_RUBRO_VISIBILIDAD_DEFAULT`.
- Create: `lib/dashboard/sin-rubro-config.ts` (+ `.test.ts`) — helpers puros para la lista del modal.
- Modify: `lib/dashboard/query-builders.ts` (+ `.test.ts`) — fragmento `sinRubroVisibleSql` y su uso en `buildPivotConditions`.
- Modify: `app/api/dashboard/detalle/route.ts:253` — misma regla en la rama sin filtro.
- Modify: `app/api/config/rubros-dashboard/route.ts` — GET/PATCH con "Sin Rubro".

---

### Task 1: Schema + migración (sin aplicar)

**Files:**
- Modify: `prisma/schema.prisma` (después del modelo `RubroConceptoCaja`, línea ~55)
- Create: `prisma/migrations/20261006120000_sin_rubro_config/migration.sql`

**Interfaces:**
- Produces: `prisma.sinRubroConfig` (campos `id: number`, `visibleEnDashboard: boolean`, `visibleEnResultados: boolean`); tabla `sin_rubro_config` con columnas `"id"`, `"visibleEnDashboard"`, `"visibleEnResultados"`.

- [ ] **Step 1: Agregar el modelo al schema**

```prisma
// Visibilidad del bucket sintético "Sin Rubro" (compras sin rubro asignado): no existe como fila
// de RubroConceptoCaja, así que su toggle vive acá. Tabla de una sola fila (id = 1).
model SinRubroConfig {
  id                  Int     @id @default(1)
  visibleEnDashboard  Boolean @default(true)
  visibleEnResultados Boolean @default(false)

  @@map("sin_rubro_config")
}
```

- [ ] **Step 2: Escribir la migración a mano**

```sql
-- CreateTable
CREATE TABLE "sin_rubro_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "visibleEnDashboard" BOOLEAN NOT NULL DEFAULT true,
    "visibleEnResultados" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sin_rubro_config_pkey" PRIMARY KEY ("id"),
    -- Prisma no puede expresar CHECK: garantiza a nivel DB que la tabla tenga una sola fila.
    CONSTRAINT "sin_rubro_config_single_row" CHECK ("id" = 1)
);

-- Fila inicial con los defaults (Compras sí, Resultados no).
INSERT INTO "sin_rubro_config" ("id") VALUES (1) ON CONFLICT DO NOTHING;
```

- [ ] **Step 3: Regenerar el cliente (NO aplicar la migración todavía)**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" sin errores; `prisma.sinRubroConfig` existe en tipos.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261006120000_sin_rubro_config
git commit -m "feat(db): tabla sin_rubro_config para la visibilidad de Sin Rubro"
```

---

### Task 2: Constantes y helpers puros

**Files:**
- Modify: `lib/dashboard/constants.ts` (al final, después de `VisibilidadField`)
- Create: `lib/dashboard/sin-rubro-config.ts`
- Test: `lib/dashboard/sin-rubro-config.test.ts`

**Interfaces:**
- Produces:
  - `SIN_RUBRO_VISIBILIDAD_DEFAULT: Record<VisibilidadField, boolean>`
  - `type SinRubroConfigRow = Record<VisibilidadField, boolean>`
  - `resolverVisibilidadSinRubro(row: SinRubroConfigRow | null, field: VisibilidadField): boolean`
  - `agregarSinRubro(rubros: RubroVisibilidad[], visible: boolean): RubroVisibilidad[]`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { agregarSinRubro, resolverVisibilidadSinRubro } from "./sin-rubro-config";
import { SIN_RUBRO_CODE, SIN_RUBRO_NOMBRE } from "./constants";

describe("resolverVisibilidadSinRubro", () => {
  it("sin fila usa el default: visible en Compras", () => {
    expect(resolverVisibilidadSinRubro(null, "visibleEnDashboard")).toBe(true);
  });

  it("sin fila usa el default: oculto en Resultados", () => {
    expect(resolverVisibilidadSinRubro(null, "visibleEnResultados")).toBe(false);
  });

  it("con fila respeta el valor guardado por vista", () => {
    const row = { visibleEnDashboard: false, visibleEnResultados: true };
    expect(resolverVisibilidadSinRubro(row, "visibleEnDashboard")).toBe(false);
    expect(resolverVisibilidadSinRubro(row, "visibleEnResultados")).toBe(true);
  });
});

describe("agregarSinRubro", () => {
  it("agrega Sin Rubro al final con el código sintético y no muta la lista original", () => {
    const base = [{ codigo: "1", nombre: "Alquiler", visible: true }];
    const out = agregarSinRubro(base, false);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ codigo: SIN_RUBRO_CODE, nombre: SIN_RUBRO_NOMBRE, visible: false });
    expect(base).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run lib/dashboard/sin-rubro-config.test.ts`
Expected: FAIL (módulo `./sin-rubro-config` no existe).

- [ ] **Step 3: Implementar**

En `lib/dashboard/constants.ts`, al final:

```ts
// "Sin Rubro" no es fila de rubros_concepto_caja, su toggle vive en sin_rubro_config. Estos defaults
// copian los de las columnas de los rubros reales y se usan si esa fila no existe (nunca ocultar en silencio).
export const SIN_RUBRO_VISIBILIDAD_DEFAULT: Record<VisibilidadField, boolean> = {
  visibleEnDashboard: true,
  visibleEnResultados: false,
};
```

`lib/dashboard/sin-rubro-config.ts`:

```ts
import {
  SIN_RUBRO_CODE,
  SIN_RUBRO_NOMBRE,
  SIN_RUBRO_VISIBILIDAD_DEFAULT,
  type VisibilidadField,
} from "./constants";
import type { RubroVisibilidad } from "./types";

export type SinRubroConfigRow = Record<VisibilidadField, boolean>;

export function resolverVisibilidadSinRubro(row: SinRubroConfigRow | null, field: VisibilidadField): boolean {
  return row ? row[field] : SIN_RUBRO_VISIBILIDAD_DEFAULT[field];
}

// Va al final para no reordenar los rubros reales (que vienen ordenados por nombre).
export function agregarSinRubro(rubros: RubroVisibilidad[], visible: boolean): RubroVisibilidad[] {
  return [...rubros, { codigo: SIN_RUBRO_CODE, nombre: SIN_RUBRO_NOMBRE, visible }];
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run lib/dashboard/sin-rubro-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/constants.ts lib/dashboard/sin-rubro-config.ts lib/dashboard/sin-rubro-config.test.ts
git commit -m "feat(dashboard): helpers de visibilidad de Sin Rubro"
```

---

### Task 3: Filtro SQL (pivot, diferencia-caja y detalle)

**Files:**
- Modify: `lib/dashboard/query-builders.ts:69-75`
- Test: `lib/dashboard/query-builders.test.ts`
- Modify: `app/api/dashboard/detalle/route.ts:253`

**Interfaces:**
- Consumes: `SIN_RUBRO_VISIBILIDAD_DEFAULT`, `VISIBILIDAD_FIELDS`, `VisibilidadField` (Task 2 / constants).
- Produces: `sinRubroVisibleSql(col: VisibilidadField): Prisma.Sql` exportada de `lib/dashboard/query-builders.ts`.

- [ ] **Step 1: Escribir los tests que fallan** (agregar al final de `query-builders.test.ts`)

```ts
describe("buildPivotConditions — visibilidad de Sin Rubro", () => {
  it("Compras: consulta sin_rubro_config con la columna del dashboard y default true", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c", filterRubrosOcultos: true }));
    expect(sql).toContain("sin_rubro_config");
    expect(sql).toContain(`s."visibleEnDashboard"`);
    expect(sql).toMatch(/,\s*true\)/);
  });

  it("Resultados: consulta la columna de resultados y default false", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c", filterRubrosOcultos: true, visibilidadCol: "visibleEnResultados" }));
    expect(sql).toContain(`s."visibleEnResultados"`);
    expect(sql).not.toContain(`s."visibleEnDashboard"`);
    expect(sql).toMatch(/,\s*false\)/);
  });

  it("ya no deja Sin Rubro incondicionalmente visible (rc.codigo IS NULL va atado al flag)", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c", filterRubrosOcultos: true }));
    expect(sql).toContain("rc.codigo IS NULL AND");
  });

  it("sin filterRubrosOcultos no consulta la config", () => {
    expect(sqlDe(buildPivotConditions({ tableAlias: "c" }))).not.toContain("sin_rubro_config");
  });

  it("con rubroCodigo explícito no consulta la config (el usuario pidió ese bucket)", () => {
    const sql = sqlDe(buildPivotConditions({ tableAlias: "c", filterRubrosOcultos: true, rubroCodigo: "__sin_rubro" }));
    expect(sql).not.toContain("sin_rubro_config");
  });
});

describe("sinRubroVisibleSql", () => {
  it("una columna fuera de la whitelist cae al dashboard, nunca se interpola cruda", () => {
    const frag = sinRubroVisibleSql("x; DROP TABLE compras" as never);
    expect(frag.sql).toContain(`s."visibleEnDashboard"`);
    expect(frag.sql).not.toContain("DROP");
  });
});
```

Y cambiar el import de arriba a: `import { buildPivotConditions, sinRubroVisibleSql } from "./query-builders";`

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run lib/dashboard/query-builders.test.ts`
Expected: FAIL (`sinRubroVisibleSql` no exportada / sin `sin_rubro_config` en el SQL).

- [ ] **Step 3: Implementar en `query-builders.ts`**

Importar `SIN_RUBRO_VISIBILIDAD_DEFAULT` junto a lo que ya se importa de `./constants`. Agregar antes de `buildPivotConditions`:

```ts
// Flag de visibilidad del bucket "Sin Rubro" (sin_rubro_config, una sola fila). COALESCE al default
// si la fila falta: ante una config rota preferimos mostrar el dato antes que ocultarlo en silencio.
// El literal del default sale de una constante nuestra (no de input), por eso va con Prisma.raw.
export function sinRubroVisibleSql(col: VisibilidadField): Prisma.Sql {
  const safe: VisibilidadField = VISIBILIDAD_FIELDS.includes(col) ? col : "visibleEnDashboard";
  const fallback = SIN_RUBRO_VISIBILIDAD_DEFAULT[safe] ? "true" : "false";
  return Prisma.sql`COALESCE((SELECT s."${Prisma.raw(safe)}" FROM sin_rubro_config s WHERE s.id = 1), ${Prisma.raw(fallback)})`;
}
```

Y reemplazar la línea `conditions.push(Prisma.sql\`(rc."${Prisma.raw(col)}" = true OR rc.codigo IS NULL)\`);` por:

```ts
    conditions.push(
      Prisma.sql`(rc."${Prisma.raw(col)}" = true OR (rc.codigo IS NULL AND ${sinRubroVisibleSql(col)}))`
    );
```

- [ ] **Step 4: Misma regla en `detalle/route.ts`** (rama sin filtro, línea ~253)

Importar `sinRubroVisibleSql` desde `@/lib/dashboard/query-builders` (si ya hay import de ese módulo, sumarlo ahí). Reemplazar:

```ts
conditions.push(Prisma.sql`(rc."visibleEnDashboard" = true OR c."conceptoCodigo" IS NULL)`);
```
por:
```ts
conditions.push(
  Prisma.sql`(rc."visibleEnDashboard" = true OR (c."conceptoCodigo" IS NULL AND ${sinRubroVisibleSql("visibleEnDashboard")}))`
);
```
No tocar el resto de la rama (el criterio de concepto no-manual es una inconsistencia previa, fuera de alcance — ver el comentario existente).

- [ ] **Step 5: Verificar**

Run: `npx vitest run lib/dashboard/query-builders.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/query-builders.ts lib/dashboard/query-builders.test.ts app/api/dashboard/detalle/route.ts
git commit -m "feat(dashboard): Sin Rubro respeta sin_rubro_config en pivot, diferencia-caja y detalle"
```

---

### Task 4: API de configuración (GET/PATCH)

**Files:**
- Modify: `app/api/config/rubros-dashboard/route.ts`

**Interfaces:**
- Consumes: `agregarSinRubro`, `resolverVisibilidadSinRubro` (Task 2), `prisma.sinRubroConfig` (Task 1), `SIN_RUBRO_CODE`.
- Produces: `GET ?field=` devuelve los rubros reales + `{ codigo: "__sin_rubro", nombre: "Sin Rubro", visible }`; `PATCH { codigo: "__sin_rubro", visible, field }` actualiza `sin_rubro_config`.

- [ ] **Step 1: GET** — reemplazar el bloque `try` del GET por:

```ts
  try {
    const [rubros, sinRubro] = await Promise.all([
      prisma.rubroConceptoCaja.findMany({
        select: { codigo: true, nombre: true, [field]: true },
        orderBy: { nombre: "asc" },
      }),
      prisma.sinRubroConfig.findUnique({ where: { id: 1 } }),
    ]);
    const visible = rubros.map((r) => ({ codigo: r.codigo, nombre: r.nombre, visible: r[field as keyof typeof r] }));
    return NextResponse.json(agregarSinRubro(visible, resolverVisibilidadSinRubro(sinRubro, field)));
  }
```
(el `catch` queda igual). Agregar imports: `SIN_RUBRO_CODE` desde constants y `agregarSinRubro`, `resolverVisibilidadSinRubro` desde `@/lib/dashboard/sin-rubro-config`.

- [ ] **Step 2: PATCH** — después de calcular `field`, antes del `updateMany`:

```ts
  // "Sin Rubro" es sintético: no hay fila en rubros_concepto_caja que actualizar, su flag vive en
  // sin_rubro_config. upsert para no depender de que la fila inicial exista.
  if (codigo === SIN_RUBRO_CODE) {
    await prisma.sinRubroConfig.upsert({
      where: { id: 1 },
      create: { id: 1, [field]: visible },
      update: { [field]: visible },
    });
    return NextResponse.json({ ok: true });
  }
```

- [ ] **Step 3: Verificar tipos y suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores de tipos; todos los tests PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/config/rubros-dashboard/route.ts
git commit -m "feat(config): Sin Rubro aparece como switch en Rubros visibles"
```

---

### Task 5: Aplicar migración y verificar (CON CONFIRMACIÓN DEL USUARIO)

**Files:** ninguno nuevo.

- [ ] **Step 1: PARAR y pedir confirmación explícita al usuario** para aplicar la migración (única DB compartida; es aditiva, no toca compras/ventas). No continuar sin un sí.

- [ ] **Step 2: Aplicar**

Run: `npx prisma migrate deploy`
Expected: aplica solo `20261006120000_sin_rubro_config`. Cualquier otra salida (otras migraciones pendientes, error) → parar y avisar.

- [ ] **Step 3: Verificar la fila**

Run: `npx tsx -e "import {prisma} from './lib/prisma'; prisma.sinRubroConfig.findMany().then(r=>{console.log(r);process.exit(0)})"`
Expected: una fila `{ id: 1, visibleEnDashboard: true, visibleEnResultados: false }`.

- [ ] **Step 4: Lint, tests, build**

Run: `npm run lint && npx vitest run && npm run build`
Expected: todo verde.

- [ ] **Step 5: Verificación manual en el dashboard** (si no hay browser disponible, decirlo explícitamente; no declararlo verificado)
  - Compras → modal "Rubros visibles en panel": aparece "Sin Rubro" prendido; Resultados → modal: aparece apagado.
  - En Resultados "Sin Rubro" no aparece en la tabla; el total del Societario bajó por ese importe.
  - Prender "Sin Rubro" en Resultados → aparece y suma; apagarlo en Compras → desaparece de Compras.
  - Dejar los switches en su default al terminar.

- [ ] **Step 6: `verification-before-completion`** antes de dar la tarea por cerrada.
