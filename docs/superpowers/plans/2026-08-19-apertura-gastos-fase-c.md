# Apertura de Gastos — Fase C (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a Diego una UI completa para crear/editar/eliminar reglas de apertura de gastos por concepto de caja (modal + línea de tiempo + indicador visual), y cerrar los dos riesgos de datos que Fase B dejó anotados (colisión de key/drill-down en `pivot`/`detalle`, reactivación automática al editar una regla inactiva).

**Architecture:** 3 cambios chicos de backend (endpoint de previsualización de total, reactivación automática, fix de `distribucionId` en `pivot`/`detalle`) + un set de componentes React nuevos bajo `components/dashboard/apertura-*` que hablan directo con `/api/apertura/reglas` (Fase B, ya en producción) — sin motor nuevo, sin tabla nueva, sin librería de formularios nueva.

**Tech Stack:** Next.js 16 (route handlers), Prisma 7 (`$queryRaw`/typed client), Zod `safeParse`, TanStack Query (`useFetchQuery`), React 19 + `useState`, shadcn/radix-ui (`Dialog`, `Select`, `Tooltip`, `ConfirmDialog`, `Badge`), Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-apertura-gastos-design.md` (secciones 4 "Resolución", 8 "UI", 10.2 "Alcance cerrado de Fase C" — commit `ba0ccc9`)

## Global Constraints

- `Number(x.toString())`, nunca `Number(x)` directo, para convertir `Prisma.Decimal` a `number` (patrón ya establecido en `pivot/route.ts`, `motor.ts`).
- Toda validación de datos externos (body de POST/PATCH, query params de GET) pasa por Zod `safeParse` en el servidor — CLAUDE.md sección 2/5.
- Sin librerías nuevas: nada de `react-hook-form`, `@tanstack/react-table`, ni un datepicker nuevo — `useState` + `<input type="date">` + Zod, mismo criterio que el resto del dashboard (CLAUDE.md sección 8).
- Reusar componentes shadcn ya presentes en el repo (`Dialog`, `Select`, `Input`, `Tooltip`, `ConfirmDialog`, `Badge`, `Spinner`) — no crear primitivos de UI nuevos.
- **El componente shadcn `Button` no tiene precedente de uso en `components/dashboard/`** (solo lo usan primitivos de `components/ui/` entre sí). Todos los botones nuevos de este plan siguen el patrón ya establecido en el dashboard: `<button>` crudo + clases Tailwind (mismo criterio que `rubros-config-modal.tsx`, `edit-row-controls.tsx`) — no introducir `Button` como primer caso de uso fuera de `components/ui/`.
- `useFetchQuery<T>(queryKey, url, opts?)` (`hooks/use-fetch-query.ts`) es el hook estándar para GETs cacheados — no hacer `fetch` manual donde ya alcanza.
- vitest para toda lógica pura nueva (TDD: test primero, ver CLAUDE.md sección 4/9.1) — la lógica que toca DB (route handlers) sigue sin test automatizado, mismo criterio de Fase B (sección 11 del diseño, sin DB de test separada).
- Ninguna regla real debe activarse en producción hasta que Fase D cierre el gap de overrides manuales sobre compra distribuida (diseño sección 4, "Decisión brainstorming Fase C") — la Task 13 de este plan usa una regla de prueba de bajo riesgo, revertida al final.
- Nombres de tabla/columna en español ya fijados por Fase A/B — este plan no agrega columnas ni tablas nuevas.

## Correcciones encontradas al escribir este plan (self-review, no requieren volver al usuario)

- **La spec (sección 8) describía un toggle "Activar↔Desactivar"** en la lista de reglas del modal, pero el backend de Fase B (`patchReglaSchema`) solo tiene `accion: "desactivar"` — no existe `accion: "activar"` (decisión deliberada de Fase B, YAGNI). Reactivar una regla inactiva se hace **editándola** (Task 2 de este plan deja `estado: "activa"` automáticamente al editar, sin importar el estado previo). La lista de reglas del modal (Task 11) muestra: regla `activa` → `Editar` / `Desactivar` / `Eliminar`; regla `inactiva` → `Editar` / `Eliminar` (sin botón "Activar" standalone).
- **El fix de colisión de key/drill-down no requiere tocar `hooks/use-pivot-screen-data.ts`.** `openDetalle(extra: Omit<DetalleFilter, "year"|"localId"|"pdvId">)` ya es genérico sobre todo `DetalleFilter` — agregar `distribucionId` al tipo (Task 3) alcanza para que el hook lo acepte sin cambios propios. Tampoco hace falta tocar la construcción de `prov.id` en el frontend: el backend (Task 3) ya lo arma único incluyendo `distribucionId`.
- **`compras-detalle-modal.tsx`'s `isEditing` (`editing?.rowId === item.rowId`) no necesita cambiar.** Alcanza con deshabilitar el trigger de edición en filas distribuidas (Task 6) — eso garantiza que `editing` nunca se setea desde una fila cuyo `rowId` está duplicado en la lista (fan-out), así que la comparación por `rowId` nunca puede matchear dos filas a la vez.

---

### Task 1: Backend — endpoint de previsualización de total (`preview-total`)

**Files:**
- Modify: `lib/apertura/schemas.ts`
- Modify: `lib/apertura/schemas.test.ts`
- Modify: `lib/apertura/motor.ts`
- Create: `app/api/apertura/reglas/preview-total/route.ts`

**Interfaces:**
- Consumes: `resolverVigencia`/`vigenciaToSql` (`lib/apertura/vigencia.ts`, ya existen), `validarSumaPorcentajes` (no se usa acá, solo referencia), `requireAuth` (`lib/auth/require-auth.ts`, ya existe).
- Produces: `previewTotalQuerySchema` (Zod, exportado de `schemas.ts`) — consumida solo por este endpoint. `condicionComprasElegibles(entidadId: string, vigenciaSql: Prisma.Sql): Prisma.Sql` (exportado de `motor.ts`) — consumida por este endpoint y por `aplicarRegla` (ya existente, no cambia su comportamiento). `GET /api/apertura/reglas/preview-total?entidadId&modo&fechaDesde&fechaHasta&extremosInclusivos` → `{ total: number }` — consumido por Task 11 (`apertura-gastos-modal.tsx`).

- [ ] **Step 1: Refactorizar `lib/apertura/schemas.ts` — extraer validación de fechas por modo y exportar el schema del query**

Reemplazar el archivo completo:

```ts
import { z } from "zod";
import { validarSumaPorcentajes } from "./validaciones";

export const destinoSchema = z
  .object({
    localId: z.number().int().positive().nullable().optional(),
    puntoDeVentaId: z.number().int().positive().nullable().optional(),
    porcentaje: z.number().min(0).max(100),
  })
  .refine((d) => d.localId != null || d.puntoDeVentaId != null, {
    message: "Cada destino requiere localId o puntoDeVentaId",
  });

// Campos de vigencia sin destinos/confirmarHistorico — reusados por
// previewTotalQuerySchema (Fase C), que solo necesita saber SOBRE QUÉ
// PERÍODO previsualizar, no validar destinos ni pedir confirmación de
// histórico (esa confirmación es del paso de guardar, no de previsualizar).
export const camposVigenciaFecha = {
  modo: z.enum(["historico", "entre_fechas", "desde_adelante", "desde_atras"]),
  fechaDesde: z.string().datetime({ offset: true }).nullable().optional(),
  fechaHasta: z.string().datetime({ offset: true }).nullable().optional(),
  extremosInclusivos: z.boolean().default(true),
};

const camposVigencia = {
  ...camposVigenciaFecha,
  destinos: z.array(destinoSchema).min(1),
  confirmarHistorico: z.boolean().optional(),
};

// Requisitos de fecha por modo — compartidos entre crear/editar regla (con
// destinos/confirmarHistorico, ver validarCuerpoRegla) y el preview de total
// (sin ellos, ver previewTotalQuerySchema más abajo).
function validarFechasPorModo(
  data: { modo: string; fechaDesde?: string | null; fechaHasta?: string | null },
  ctx: z.RefinementCtx
) {
  if (data.modo === "entre_fechas" && (!data.fechaDesde || !data.fechaHasta)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "modo 'entre_fechas' requiere fechaDesde y fechaHasta",
      path: ["fechaDesde"],
    });
  }
  if (data.modo === "desde_adelante" && !data.fechaDesde) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "modo 'desde_adelante' requiere fechaDesde", path: ["fechaDesde"] });
  }
  if (data.modo === "desde_atras" && !data.fechaHasta) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "modo 'desde_atras' requiere fechaHasta", path: ["fechaHasta"] });
  }
}

// Reglas de negocio comunes a crear y editar — no reinventar por endpoint. Ver
// docs/superpowers/specs/2026-08-19-apertura-gastos-design.md sección 7/10.1.
function validarCuerpoRegla(
  data: {
    modo: string;
    fechaDesde?: string | null;
    fechaHasta?: string | null;
    destinos: { porcentaje: number }[];
    confirmarHistorico?: boolean;
  },
  ctx: z.RefinementCtx
) {
  if (!validarSumaPorcentajes(data.destinos)) {
    const suma = data.destinos.reduce((acc, d) => acc + d.porcentaje, 0);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `La suma de porcentajes debe ser 100 (actual: ${suma})`,
      path: ["destinos"],
    });
  }
  validarFechasPorModo(data, ctx);
  if (data.modo === "historico" && data.confirmarHistorico !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "modo 'historico' requiere confirmarHistorico: true",
      path: ["confirmarHistorico"],
    });
  }
}

export const crearReglaSchema = z
  .object({
    entidadId: z.string().min(1).max(50),
    ...camposVigencia,
  })
  .superRefine(validarCuerpoRegla);

export type CrearReglaInput = z.infer<typeof crearReglaSchema>;

// PATCH tiene dos formas mutuamente excluyentes, discriminadas por "accion":
// desactivar (solo detiene aplicación futura, no toca distribuciones ya
// generadas) o editar (reemplaza destinos/vigencia y reactiva la regla
// automáticamente — ver app/api/apertura/reglas/[id]/route.ts, Task 2 de
// Fase C). No existe accion "activar" standalone: sin caso de uso sin editar
// también los datos, no se inventa (YAGNI).
export const patchReglaSchema = z
  .discriminatedUnion("accion", [
    z.object({ accion: z.literal("desactivar") }),
    z.object({ accion: z.literal("editar"), ...camposVigencia }),
  ])
  .superRefine((data, ctx) => {
    if (data.accion === "editar") validarCuerpoRegla(data, ctx);
  });

export type PatchReglaInput = z.infer<typeof patchReglaSchema>;

// Query params de GET /api/apertura/reglas/preview-total (Fase C) — mismo
// criterio de vigencia que crear/editar, sin destinos ni confirmarHistorico
// (es una previsualización de lectura, no una escritura).
export const previewTotalQuerySchema = z
  .object({
    entidadId: z.string().min(1).max(50),
    ...camposVigenciaFecha,
  })
  .superRefine(validarFechasPorModo);

export type PreviewTotalQuery = z.infer<typeof previewTotalQuerySchema>;
```

- [ ] **Step 2: Agregar tests de `previewTotalQuerySchema`**

Agregar al final de `lib/apertura/schemas.test.ts` (no tocar los describe existentes):

```ts
describe("previewTotalQuerySchema", () => {
  it("acepta modo historico con solo entidadId (sin confirmarHistorico — no aplica al preview)", () => {
    const result = previewTotalQuerySchema.safeParse({ entidadId: "17", modo: "historico" });
    expect(result.success).toBe(true);
  });

  it("acepta modo entre_fechas con ambas fechas", () => {
    const result = previewTotalQuerySchema.safeParse({
      entidadId: "17",
      modo: "entre_fechas",
      fechaDesde: "2026-01-01T00:00:00Z",
      fechaHasta: "2026-01-31T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza desde_adelante sin fechaDesde", () => {
    const result = previewTotalQuerySchema.safeParse({ entidadId: "17", modo: "desde_adelante" });
    expect(result.success).toBe(false);
  });

  it("rechaza desde_atras sin fechaHasta", () => {
    const result = previewTotalQuerySchema.safeParse({ entidadId: "17", modo: "desde_atras" });
    expect(result.success).toBe(false);
  });

  it("rechaza entidadId vacío", () => {
    const result = previewTotalQuerySchema.safeParse({ entidadId: "", modo: "historico" });
    expect(result.success).toBe(false);
  });
});
```

Actualizar el import del archivo a:

```ts
import { crearReglaSchema, patchReglaSchema, previewTotalQuerySchema } from "./schemas";
```

- [ ] **Step 3: Correr los tests y confirmar que pasan (incluidos los ya existentes, sin cambios de comportamiento)**

Run: `npx vitest run lib/apertura/schemas.test.ts`
Expected: PASS, 19 tests (14 existentes + 5 nuevos).

- [ ] **Step 4: Extraer `condicionComprasElegibles` en `lib/apertura/motor.ts`**

Modificar `lib/apertura/motor.ts`: agregar la función exportada antes de `aplicarRegla`, y reemplazar el `$queryRaw` inline de `aplicarRegla` para que la use.

Agregar (después de `resolverLocalIdDestinos`, antes de `aplicarRegla`):

```ts
// Condición WHERE + SELECT compartidos entre aplicarRegla (motor real) y el
// endpoint de preview de Fase C (GET /api/apertura/reglas/preview-total) —
// extraída para que ambos NUNCA puedan divergir en qué compras cuentan como
// "elegibles" (mismo concepto efectivo, no bloqueada, no distribuida, con
// importe efectivo, dentro de la vigencia). Devuelve el SELECT completo (no
// solo el WHERE) porque ambos callers necesitan las mismas columnas —
// aplicarRegla las usa fila por fila, preview-total las suma en un subquery.
export function condicionComprasElegibles(entidadId: string, vigenciaSql: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT c."rowId", COALESCE(c."importeManual", c.importe) AS "importeBase"
    FROM compras c
    WHERE COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${entidadId}
      AND c."esBloqueado" = false
      AND c."esDistribuido" = false
      AND COALESCE(c."importeManual", c.importe) IS NOT NULL
      AND (${vigenciaSql})
  `;
}
```

Reemplazar dentro de `aplicarRegla`:

```ts
  const compras = await prisma.$queryRaw<{ rowId: string; importeBase: Prisma.Decimal }[]>(Prisma.sql`
    SELECT c."rowId", COALESCE(c."importeManual", c.importe) AS "importeBase"
    FROM compras c
    WHERE COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${input.entidadId}
      AND c."esBloqueado" = false
      AND c."esDistribuido" = false
      AND COALESCE(c."importeManual", c.importe) IS NOT NULL
      AND (${vigenciaSql})
  `);
```

por:

```ts
  const compras = await prisma.$queryRaw<{ rowId: string; importeBase: Prisma.Decimal }[]>(
    condicionComprasElegibles(input.entidadId, vigenciaSql)
  );
```

- [ ] **Step 5: Crear el route handler `app/api/apertura/reglas/preview-total/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { previewTotalQuerySchema } from "@/lib/apertura/schemas";
import { condicionComprasElegibles } from "@/lib/apertura/motor";
import { resolverVigencia, vigenciaToSql, type ReglaVigencia } from "@/lib/apertura/vigencia";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = previewTotalQuerySchema.safeParse({
    entidadId: searchParams.get("entidadId") ?? undefined,
    modo: searchParams.get("modo") ?? undefined,
    fechaDesde: searchParams.get("fechaDesde") ?? undefined,
    fechaHasta: searchParams.get("fechaHasta") ?? undefined,
    // Ausente en la URL == default true (mismo default que el schema);
    // "false" explícito == false. Se pre-coerciona acá porque los query
    // params siempre llegan como string, nunca como boolean real.
    extremosInclusivos: searchParams.get("extremosInclusivos") !== "false",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 422 });
  }
  const { entidadId, modo, fechaDesde, fechaHasta, extremosInclusivos } = parsed.data;

  const vigencia: ReglaVigencia = {
    modo,
    fechaDesde: fechaDesde ? new Date(fechaDesde) : null,
    fechaHasta: fechaHasta ? new Date(fechaHasta) : null,
    extremosInclusivos,
  };

  try {
    const cond = resolverVigencia(vigencia);
    const fechaEfectiva = Prisma.sql`COALESCE(c."fechaManual", c.fecha)`;
    const vigenciaSql = vigenciaToSql(cond, fechaEfectiva);

    const rows = await prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT COALESCE(SUM(sub."importeBase"), 0) AS total
      FROM (${condicionComprasElegibles(entidadId, vigenciaSql)}) sub
    `);

    const total = rows[0]?.total != null ? Number(rows[0].total.toString()) : 0;
    return NextResponse.json({ total });
  } catch (err) {
    console.error("[GET /api/apertura/reglas/preview-total]", err);
    return NextResponse.json({ error: "Error interno al calcular el total" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Correr el suite completo de `lib/apertura` y verificar tipos**

Run: `npx vitest run lib/apertura` && `npx tsc --noEmit`
Expected: todos los tests PASS (incluye `calculo.test.ts`, `vigencia.test.ts`, `validaciones.test.ts`, `schemas.test.ts`), 0 errores de tipos. El endpoint en sí no tiene test automatizado (toca DB, sin DB de test — mismo criterio que `aplicarRegla`); su verificación queda en Task 13.

- [ ] **Step 7: Commit**

```bash
git add lib/apertura/schemas.ts lib/apertura/schemas.test.ts lib/apertura/motor.ts app/api/apertura/reglas/preview-total/route.ts
git commit -m "feat(apertura-gastos): agrega endpoint de previsualización de total"
```

---

### Task 2: Backend — reactivación automática al editar una regla

**Files:**
- Modify: `app/api/apertura/reglas/[id]/route.ts:104-120`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `PATCH /api/apertura/reglas/[id]` con `accion: "editar"` deja `estado: "activa"` sin importar el estado previo — consumido por Task 11 (la UI puede editar una regla inactiva sin un botón "Activar" separado, ver corrección de arriba).

- [ ] **Step 1: Agregar `estado: "activa"` al `update` de la rama `editar`**

En `app/api/apertura/reglas/[id]/route.ts`, dentro del `$transaction` de `PATCH`, el `tx.reglaApertura.update` (líneas 104-120 del archivo actual) pasa de:

```ts
        const regla = await tx.reglaApertura.update({
          where: { id },
          data: {
            modo,
            fechaDesde: vigenciaNueva.fechaDesde,
            fechaHasta: vigenciaNueva.fechaHasta,
            extremosInclusivos,
            destinos: {
              create: destinosResueltos.map((d) => ({
                localId: d.localId,
                puntoDeVentaId: d.puntoDeVentaId,
                porcentaje: d.porcentaje,
              })),
            },
          },
          include: { destinos: true },
        });
```

a:

```ts
        const regla = await tx.reglaApertura.update({
          where: { id },
          data: {
            modo,
            fechaDesde: vigenciaNueva.fechaDesde,
            fechaHasta: vigenciaNueva.fechaHasta,
            extremosInclusivos,
            // Editar reactiva siempre — una regla editada tiene distribuciones
            // vivas recién generadas por aplicarRegla más abajo, así que no
            // puede quedar "inactiva" (invisible para el chequeo de
            // superposición de cualquier regla futura). Sin condicional sobre
            // el estado previo: es semántica del endpoint, no solo de la UI
            // (Fase C, decisión de brainstorming 19-ago-2026).
            estado: "activa",
            destinos: {
              create: destinosResueltos.map((d) => ({
                localId: d.localId,
                puntoDeVentaId: d.puntoDeVentaId,
                porcentaje: d.porcentaje,
              })),
            },
          },
          include: { destinos: true },
        });
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores. Sin test automatizado (route handler toca DB); verificación queda en Task 13 (crear una regla, desactivarla, editarla, confirmar que vuelve a `estado: "activa"`).

- [ ] **Step 3: Commit**

```bash
git add app/api/apertura/reglas/[id]/route.ts
git commit -m "fix(apertura-gastos): editar una regla la reactiva automáticamente"
```

---

### Task 3: Backend + tipos compartidos — fix de colisión de key/drill-down en `pivot`/`detalle`

**Files:**
- Modify: `lib/dashboard/types.ts`
- Modify: `app/api/dashboard/pivot/route.ts`
- Modify: `app/api/dashboard/detalle/route.ts`

**Interfaces:**
- Produces: `SqlRow.distribucion_id: number | null`, `PivotProveedorRow.distribucionId: number | null`, `DetalleFilter.distribucionId?: number` (todos en `lib/dashboard/types.ts`) — consumidos por Task 5 (`pivot-table.tsx`). `GET /api/dashboard/detalle?rowId=X&distribucionId=Y` devuelve la porción puntual de esa distribución en vez de la compra completa.

- [ ] **Step 1: Agregar `distribucionId`/`distribucion_id` a los tipos de `lib/dashboard/types.ts`**

En `PivotProveedorRow`, agregar el campo (después de `rowId`):

```ts
export type PivotProveedorRow = {
  readonly level: 2;
  readonly id: string;
  readonly rowId: string;
  readonly distribucionId: number | null;
  readonly nombre: string;
  readonly fecha: string | null;
  readonly observac: string | null;
  readonly importe: number;
  readonly proveedorId: number | null;
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;
  readonly hasManualOverride: boolean;
  values: Record<number, number>;
  rowTotal: number;
};
```

En `DetalleFilter`, agregar el campo:

```ts
export type DetalleFilter = BaseDashboardFilter & {
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  rowId?: string;
  distribucionId?: number;
};
```

En `SqlRow`, agregar el campo (después de `row_id`):

```ts
export type SqlRow = {
  rubro_codigo: string;
  rubro_nombre: string;
  concepto_codigo: string;
  concepto_nombre: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  mes: number;
  total: DecimalLike;
  row_id: string;
  distribucion_id: number | null;
  fecha: string | null;
  observac: string | null;
  has_manual_override: boolean;
};
```

- [ ] **Step 2: Agregar `distribucionId` al SELECT y a la construcción de filas en `app/api/dashboard/pivot/route.ts`**

El SELECT (líneas 40-61) pasa de:

```ts
  const rows = await prisma.$queryRaw<SqlRow[]>(Prisma.sql`
    SELECT
      COALESCE(rc.codigo, '__sin_rubro')                                  AS rubro_codigo,
      COALESCE(rc.nombre, 'Sin Rubro')                                   AS rubro_nombre,
      COALESCE(cc.codigo, '__sin_concepto')                              AS concepto_codigo,
      COALESCE(cc.nombre, 'Sin Concepto')                                AS concepto_nombre,
      p.id                                                                AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')         AS proveedor_nombre,
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int        AS mes,
      COALESCE(c."importeManual", c.importe)                             AS total,
      c."rowId"                                                           AS row_id,
      TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')         AS fecha,
      COALESCE(c."observacManual", c.observac)                           AS observac,
      (c."importeManual" IS NOT NULL OR c."fechaManual" IS NOT NULL
        OR c."conceptoCodigoManual" IS NOT NULL OR c."observacManual" IS NOT NULL) AS has_manual_override
    FROM v_compras_distribuidas c
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE ${where}
    ORDER BY rubro_nombre NULLS LAST, concepto_nombre NULLS LAST, COALESCE(c."fechaManual", c.fecha) NULLS LAST, proveedor_nombre NULLS LAST
  `);
```

a (agrega la línea `c."distribucionId" AS distribucion_id`, sin tocar nada más):

```ts
  const rows = await prisma.$queryRaw<SqlRow[]>(Prisma.sql`
    SELECT
      COALESCE(rc.codigo, '__sin_rubro')                                  AS rubro_codigo,
      COALESCE(rc.nombre, 'Sin Rubro')                                   AS rubro_nombre,
      COALESCE(cc.codigo, '__sin_concepto')                              AS concepto_codigo,
      COALESCE(cc.nombre, 'Sin Concepto')                                AS concepto_nombre,
      p.id                                                                AS proveedor_id,
      COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')         AS proveedor_nombre,
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int        AS mes,
      COALESCE(c."importeManual", c.importe)                             AS total,
      c."rowId"                                                           AS row_id,
      c."distribucionId"                                                  AS distribucion_id,
      TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')         AS fecha,
      COALESCE(c."observacManual", c.observac)                           AS observac,
      (c."importeManual" IS NOT NULL OR c."fechaManual" IS NOT NULL
        OR c."conceptoCodigoManual" IS NOT NULL OR c."observacManual" IS NOT NULL) AS has_manual_override
    FROM v_compras_distribuidas c
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga"         = rc.codigo
    LEFT JOIN proveedores p           ON c."proveedorId"     = p.id
    WHERE ${where}
    ORDER BY rubro_nombre NULLS LAST, concepto_nombre NULLS LAST, COALESCE(c."fechaManual", c.fecha) NULLS LAST, proveedor_nombre NULLS LAST
  `);
```

- [ ] **Step 3: Propagar `distribucion_id` en `buildPivotData`**

En la destructuración de `row` (dentro de `buildPivotData`), agregar `distribucion_id`:

```ts
    const {
      rubro_codigo,
      rubro_nombre,
      concepto_codigo,
      concepto_nombre,
      proveedor_id,
      proveedor_nombre,
      mes,
      total,
      row_id,
      distribucion_id,
      fecha,
      observac,
      has_manual_override,
    } = row;
```

Y en la construcción de `provRow`, cambiar el `id` (para que no colisione entre filas de fan-out del mismo `row_id`) y agregar `distribucionId`:

```ts
    const provRow: PivotProveedorRow = {
      level: 2,
      id: `${concKey}|${row_id}|${distribucion_id ?? "orig"}`,
      rowId: row_id,
      distribucionId: distribucion_id,
      nombre: proveedor_nombre,
      fecha: fecha ?? null,
      observac: observac ?? null,
      importe: t,
      proveedorId: proveedor_id,
      conceptoCodigo: concepto_codigo,
      rubroCodigo: rubro_codigo,
      hasManualOverride: !!has_manual_override,
      values: { [mes]: t },
      rowTotal: t,
    };
```

- [ ] **Step 4: Aceptar `distribucionId` opcional en el branch `?rowId=` de `app/api/dashboard/detalle/route.ts`**

Reemplazar el bloque actual (líneas 85-118):

```ts
  const rowId = searchParams.get("rowId") ?? undefined;

  // Filtro por rowId puntual (PK de compras, no de la vista) — se mantiene
  // sobre `compras` directo, sin cambios de comportamiento (diseño sección 4:
  // este caso no migra a la vista).
  if (rowId) {
    const compra = await prisma.compra.findUnique({
      where: { rowId },
      select: {
        rowId: true,
        fecha: true,
        importe: true,
        importeManual: true,
        fechaManual: true,
        conceptoCodigoManual: true,
        concepto: true,
        detalle: true,
        observac: true,
        observacManual: true,
        proveedor: true,
        proveedorRef: { select: { id: true, nombre: true, razon: true } },
        local: { select: { nombre: true } },
        puntoDeVenta: { select: { nombre: true } },
        conceptoCaja: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
        conceptoCajaManual: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
      },
    });
    // distribucionId: siempre null en esta rama — es un lookup puntual de una
    // sola compra por su PK, nunca puede ser parte de un fan-out de reglas de
    // apertura (esas viven exclusivamente en v_compras_distribuidas, ver nota
    // en reshapeDetalle). Se agrega explícito para que el consumidor no reciba
    // `undefined` donde el resto del endpoint siempre devuelve `null`.
    return NextResponse.json({ data: compra ? [{ ...compra, distribucionId: null }] : [] });
  }
```

por:

```ts
  const rowId = searchParams.get("rowId") ?? undefined;
  const distribucionIdRaw = searchParams.get("distribucionId");
  const distribucionId = distribucionIdRaw ? idSchema.safeParse(distribucionIdRaw).data : undefined;

  // Filtro por rowId puntual — se mantiene fuera de la vista (diseño sección
  // 4: este caso no migra a v_compras_distribuidas). Dos variantes:
  if (rowId) {
    // (a) Con distribucionId: el click vino de una fila de fan-out del pivot
    // (Task 5) — hay que devolver ESA porción puntual, no la compra completa.
    // Antes de este fix, esta rama ignoraba distribucionId por completo y
    // siempre devolvía la compra sin distribuir (fix Fase C, ver diseño
    // sección 4 "Resolución brainstorming Fase C").
    if (distribucionId !== undefined) {
      const distribucion = await prisma.distribucionApertura.findFirst({
        where: { id: distribucionId, compraRowId: rowId },
        select: {
          id: true,
          importeCalculado: true,
          destino: {
            select: {
              local: { select: { nombre: true } },
              puntoDeVenta: { select: { nombre: true } },
            },
          },
          compra: {
            select: {
              rowId: true,
              fecha: true,
              fechaManual: true,
              conceptoCodigoManual: true,
              concepto: true,
              detalle: true,
              observac: true,
              observacManual: true,
              proveedor: true,
              proveedorRef: { select: { id: true, nombre: true, razon: true } },
              conceptoCaja: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
              conceptoCajaManual: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
            },
          },
        },
      });
      if (!distribucion) return NextResponse.json({ data: [] });
      const { compra } = distribucion;
      return NextResponse.json({
        data: [
          {
            rowId: compra.rowId,
            distribucionId: distribucion.id,
            fecha: compra.fecha,
            // importeManual siempre null acá: el override ya se usó como
            // base del cálculo (diseño sección 5), importeCalculado ES el
            // importe efectivo de esta porción — aplicarlo de nuevo sería
            // doble aplicación.
            importe: distribucion.importeCalculado,
            importeManual: null,
            fechaManual: compra.fechaManual,
            conceptoCodigoManual: compra.conceptoCodigoManual,
            concepto: compra.concepto,
            detalle: compra.detalle,
            observac: compra.observac,
            observacManual: compra.observacManual,
            proveedor: compra.proveedor,
            proveedorRef: compra.proveedorRef,
            local: distribucion.destino.local,
            puntoDeVenta: distribucion.destino.puntoDeVenta,
            conceptoCaja: compra.conceptoCaja,
            conceptoCajaManual: compra.conceptoCajaManual,
          },
        ],
      });
    }

    // (b) Sin distribucionId: comportamiento original intacto, usado por
    // compra-lineas/[compraId] y por la edición manual — ambos siempre
    // operan sobre la compra completa, nunca sobre una porción.
    const compra = await prisma.compra.findUnique({
      where: { rowId },
      select: {
        rowId: true,
        fecha: true,
        importe: true,
        importeManual: true,
        fechaManual: true,
        conceptoCodigoManual: true,
        concepto: true,
        detalle: true,
        observac: true,
        observacManual: true,
        proveedor: true,
        proveedorRef: { select: { id: true, nombre: true, razon: true } },
        local: { select: { nombre: true } },
        puntoDeVenta: { select: { nombre: true } },
        conceptoCaja: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
        conceptoCajaManual: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
      },
    });
    return NextResponse.json({ data: compra ? [{ ...compra, distribucionId: null }] : [] });
  }
```

`idSchema` ya está importado en este archivo (línea 5, `import { mesSchema, yearSchema, idSchema, codigoSchema } from "@/lib/dashboard/schemas";`) — no hace falta agregar imports nuevos. `prisma.distribucionApertura` y sus relaciones (`compra`, `destino`) ya existen en el schema de Prisma desde Fase A (`prisma/schema.prisma`, modelo `DistribucionApertura`).

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores. Sin test automatizado nuevo (ambos route handlers tocan DB); verificación queda en Task 13.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/types.ts app/api/dashboard/pivot/route.ts app/api/dashboard/detalle/route.ts
git commit -m "fix(apertura-gastos): distribucionId en pivot/detalle evita colisión de key y drill-down incorrecto"
```

---

### Task 4: Lógica pura — conversión %↔$ bidireccional

**Files:**
- Create: `lib/apertura/conversion.ts`
- Create: `lib/apertura/conversion.test.ts`

**Interfaces:**
- Produces: `montoDesdePct(pct: number, total: number): number`, `pctDesdeMonto(monto: number, total: number): number` — consumidos por Task 9 (`apertura-destino-row.tsx`).

- [ ] **Step 1: Escribir los tests (deben fallar — el módulo no existe todavía)**

```ts
// lib/apertura/conversion.test.ts
import { describe, it, expect } from "vitest";
import { montoDesdePct, pctDesdeMonto } from "./conversion";

describe("montoDesdePct", () => {
  it("60% de 1.000.000 = 600.000", () => {
    expect(montoDesdePct(60, 1000000)).toBe(600000);
  });

  it("33.33% de 100 redondea a 2 decimales (33.33)", () => {
    expect(montoDesdePct(33.33, 100)).toBe(33.33);
  });

  it("0% de cualquier total = 0", () => {
    expect(montoDesdePct(0, 500000)).toBe(0);
  });

  it("100% devuelve el total exacto", () => {
    expect(montoDesdePct(100, 123456.78)).toBe(123456.78);
  });
});

describe("pctDesdeMonto", () => {
  it("600.000 de un total de 1.000.000 = 60%", () => {
    expect(pctDesdeMonto(600000, 1000000)).toBe(60);
  });

  it("total 0 devuelve 0% en vez de dividir por cero", () => {
    expect(pctDesdeMonto(500, 0)).toBe(0);
  });

  it("total negativo (no debería ocurrir en la práctica, pero no debe romper) devuelve 0%", () => {
    expect(pctDesdeMonto(500, -100)).toBe(0);
  });

  it("redondea a 2 decimales", () => {
    expect(pctDesdeMonto(1, 3)).toBe(33.33);
  });

  it("es la inversa de montoDesdePct para valores exactos", () => {
    const monto = montoDesdePct(45, 200000);
    expect(pctDesdeMonto(monto, 200000)).toBe(45);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run lib/apertura/conversion.test.ts`
Expected: FAIL con "Cannot find module './conversion'".

- [ ] **Step 3: Implementar `lib/apertura/conversion.ts`**

```ts
// Conversión %↔$ del campo bidireccional de cada destino en el modal de
// apertura de gastos (Fase C, apertura-destino-row.tsx) — puro, sin acceso a
// DB/red, 100% testeable. Mismo redondeo a 2 decimales que calcularDistribuciones
// (./calculo.ts) — no es un cálculo autoritativo (eso lo hace el motor al
// guardar), solo la previsualización que ve el usuario mientras arma la regla.

export function montoDesdePct(pct: number, total: number): number {
  return Math.round(pct * total) / 100;
}

export function pctDesdeMonto(monto: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((monto / total) * 10000) / 100;
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run lib/apertura/conversion.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/conversion.ts lib/apertura/conversion.test.ts
git commit -m "feat(apertura-gastos): agrega conversión pura %↔\$ para el campo bidireccional"
```

---

### Task 5: Frontend — pasar `distribucionId` en el drill-down de `pivot-table.tsx`

**Files:**
- Modify: `components/dashboard/pivot-table.tsx:247-257`
- Modify: `lib/dashboard/params.ts:88-98`

**Interfaces:**
- Consumes: `PivotProveedorRow.distribucionId` (Task 3), `DetalleFilter.distribucionId` (Task 3).
- Produces: nada nuevo (cierra el fix de colisión iniciado en Task 3).

- [ ] **Step 1: Agregar `distribucionId` a `buildComprasDetalleUrl`**

En `lib/dashboard/params.ts`, la función pasa de:

```ts
export function buildComprasDetalleUrl(filter: DetalleFilter): string {
  const params = new URLSearchParams({ year: String(filter.year) });
  if (filter.localId) params.set("localId", String(filter.localId));
  if (filter.pdvId) params.set("pdvId", String(filter.pdvId));
  if (filter.mes) params.set("mes", String(filter.mes));
  if (filter.rubroCodigo) params.set("rubroCodigo", filter.rubroCodigo);
  if (filter.conceptoCodigo) params.set("conceptoCodigo", filter.conceptoCodigo);
  if (filter.proveedorId) params.set("proveedorId", String(filter.proveedorId));
  if (filter.rowId) params.set("rowId", filter.rowId);
  return `/api/dashboard/detalle?${params}`;
}
```

a:

```ts
export function buildComprasDetalleUrl(filter: DetalleFilter): string {
  const params = new URLSearchParams({ year: String(filter.year) });
  if (filter.localId) params.set("localId", String(filter.localId));
  if (filter.pdvId) params.set("pdvId", String(filter.pdvId));
  if (filter.mes) params.set("mes", String(filter.mes));
  if (filter.rubroCodigo) params.set("rubroCodigo", filter.rubroCodigo);
  if (filter.conceptoCodigo) params.set("conceptoCodigo", filter.conceptoCodigo);
  if (filter.proveedorId) params.set("proveedorId", String(filter.proveedorId));
  if (filter.rowId) params.set("rowId", filter.rowId);
  if (filter.distribucionId != null) params.set("distribucionId", String(filter.distribucionId));
  return `/api/dashboard/detalle?${params}`;
}
```

- [ ] **Step 2: Pasar `distribucionId` en los dos `openDetalle({ rowId: prov.rowId })` de `pivot-table.tsx`**

Las dos ocurrencias (celda de mes, línea ~249, y celda de total, línea ~257) pasan de:

```tsx
                      onClick={() => {
                        if (hasValue(prov.values[mes]))
                          openDetalle({ rowId: prov.rowId });
                      }}
```

y

```tsx
                    onClick={() => openDetalle({ rowId: prov.rowId })}
```

a:

```tsx
                      onClick={() => {
                        if (hasValue(prov.values[mes]))
                          openDetalle({ rowId: prov.rowId, distribucionId: prov.distribucionId ?? undefined });
                      }}
```

y

```tsx
                    onClick={() => openDetalle({ rowId: prov.rowId, distribucionId: prov.distribucionId ?? undefined })}
```

`openDetalle` (`hooks/use-pivot-screen-data.ts`) no necesita cambios: su firma es `Omit<DetalleFilter, "year"|"localId"|"pdvId">`, genérica sobre todo `DetalleFilter` — el campo nuevo (Task 3) se propaga solo.

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/pivot-table.tsx lib/dashboard/params.ts
git commit -m "fix(apertura-gastos): pivot pasa distribucionId al abrir el detalle de una fila distribuida"
```

---

### Task 6: Frontend — identidad de fila distribuida en `compras-detalle-modal.tsx`

**Files:**
- Modify: `components/dashboard/compras-detalle-modal.tsx`

**Interfaces:**
- Consumes: `CompraDetalle.distribucionId` (ya existe desde Fase B).
- Produces: nada nuevo — cierra el riesgo de key duplicada + deshabilita edición sobre porciones distribuidas.

- [ ] **Step 1: Agregar imports de `Tooltip` y `Pencil`**

Agregar al inicio de `components/dashboard/compras-detalle-modal.tsx` (junto a los imports de `lucide-react` y `components/ui`):

```ts
import { Pencil } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

(`Pencil` se suma a la lista ya existente de íconos importados de `lucide-react`; `Tooltip*` es un import nuevo.)

- [ ] **Step 2: Deshabilitar "ver líneas" en filas distribuidas**

La celda de detalle (dentro de `ComprasRow`, rama no-editing) pasa de:

```tsx
      <td className="px-3 py-1.5">
        {item.detalle ? (
          <button
            onClick={() => onOpenLineas(item.rowId, item.detalle)}
            className="text-muted-foreground hover:text-foreground hover:underline font-mono text-xs whitespace-nowrap"
          >
            {item.detalle}
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
```

a:

```tsx
      <td className="px-3 py-1.5">
        {!item.detalle ? (
          <span className="text-muted-foreground">—</span>
        ) : item.distribucionId == null ? (
          <button
            onClick={() => onOpenLineas(item.rowId, item.detalle)}
            className="text-muted-foreground hover:text-foreground hover:underline font-mono text-xs whitespace-nowrap"
          >
            {item.detalle}
          </button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground font-mono text-xs whitespace-nowrap cursor-default">
                {item.detalle}
              </span>
            </TooltipTrigger>
            <TooltipContent>Compra distribuida — el detalle por líneas no está disponible acá todavía.</TooltipContent>
          </Tooltip>
        )}
      </td>
```

- [ ] **Step 3: Deshabilitar el trigger de edición en filas distribuidas**

La celda de acciones (dentro de `ComprasRow`, rama no-editing) pasa de:

```tsx
      <td className="px-2 py-1.5">
        <EditTriggerButton
          onClick={() => {
            const initialConcepto = item.conceptoCodigoManual ?? item.conceptoCaja?.codigo ?? "";
            const initialRubro = conceptoOptions.find(o => o.codigo === initialConcepto)?.rubroCodigo ?? SIN_RUBRO_CODE;
            onEdit({
              rowId: String(item.rowId),
              importeManual: toEditString(item.importeManual ?? item.importe),
              fechaManual: toDateInputValue(item.fechaManual ?? item.fecha),
              conceptoCodigoManual: initialConcepto,
              observacManual: item.observacManual ?? "",
              rubroFiltro: initialRubro,
            });
          }}
        />
      </td>
```

a:

```tsx
      <td className="px-2 py-1.5">
        {item.distribucionId == null ? (
          <EditTriggerButton
            onClick={() => {
              const initialConcepto = item.conceptoCodigoManual ?? item.conceptoCaja?.codigo ?? "";
              const initialRubro = conceptoOptions.find(o => o.codigo === initialConcepto)?.rubroCodigo ?? SIN_RUBRO_CODE;
              onEdit({
                rowId: String(item.rowId),
                importeManual: toEditString(item.importeManual ?? item.importe),
                fechaManual: toDateInputValue(item.fechaManual ?? item.fecha),
                conceptoCodigoManual: initialConcepto,
                observacManual: item.observacManual ?? "",
                rubroFiltro: initialRubro,
              });
            }}
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/30 cursor-default">
                <Pencil className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent>No se puede editar una porción distribuida todavía — editá la compra completa antes de aperturarla.</TooltipContent>
          </Tooltip>
        )}
      </td>
```

- [ ] **Step 4: Cambiar la key de fila para no colisionar en compras distribuidas**

En el `renderRow` pasado a `DetalleModalShell`, cambiar:

```tsx
        renderRow={(item, portalContainer) => (
          <ComprasRow
            key={item.rowId}
```

a:

```tsx
        renderRow={(item, portalContainer) => (
          // distribucionId ?? rowId: una compra distribuida en N destinos
          // genera N objetos CompraDetalle con el mismo rowId (fan-out de
          // v_compras_distribuidas) — sin esto, React ve keys duplicadas.
          // isEditing (más abajo, sin cambios) sigue comparando por rowId sin
          // riesgo: el trigger de edición está deshabilitado en toda fila con
          // distribucionId != null (Step 3), así que `editing` nunca se
          // setea desde una fila cuyo rowId está duplicado en esta lista.
          <ComprasRow
            key={item.distribucionId != null ? `d-${item.distribucionId}` : item.rowId}
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/compras-detalle-modal.tsx
git commit -m "fix(apertura-gastos): compras-detalle-modal usa distribucionId como identidad de fila y deshabilita edición sobre porciones distribuidas"
```

---

### Task 7: Frontend — tipos DTO + hook compartido de reglas

**Files:**
- Create: `lib/apertura/types.ts`
- Create: `hooks/use-reglas-apertura.ts`

**Interfaces:**
- Produces: `ReglaAperturaDTO`, `DestinoReglaDTO`, `ModoVigenciaApi`, `EstadoReglaApi` (`lib/apertura/types.ts`); `useReglasApertura(): { reglas: ReglaAperturaDTO[], isLoading: boolean, error: Error | null }` (`hooks/use-reglas-apertura.ts`) — consumidos por Task 11 y Task 12.

- [ ] **Step 1: Crear `lib/apertura/types.ts`**

```ts
// DTOs del lado cliente para las respuestas de /api/apertura/reglas —
// Prisma.Decimal serializa a string sobre JSON (mismo criterio que
// CompraDetalle en lib/dashboard/types.ts), DateTime serializa a ISO string.

export type ModoVigenciaApi = "historico" | "entre_fechas" | "desde_adelante" | "desde_atras";
export type EstadoReglaApi = "activa" | "inactiva";

export interface DestinoReglaDTO {
  id: number;
  reglaId: number;
  localId: number | null;
  puntoDeVentaId: number | null;
  porcentaje: string;
}

export interface ReglaAperturaDTO {
  id: number;
  nivel: string;
  entidadId: string;
  modo: ModoVigenciaApi;
  fechaDesde: string | null;
  fechaHasta: string | null;
  extremosInclusivos: boolean;
  estado: EstadoReglaApi;
  creadoPor: string | null;
  creadoEn: string;
  destinos: DestinoReglaDTO[];
}
```

- [ ] **Step 2: Crear `hooks/use-reglas-apertura.ts`**

```ts
"use client";
import { useFetchQuery } from "./use-fetch-query";
import type { ReglaAperturaDTO } from "@/lib/apertura/types";

// Una sola query cacheada por TanStack Query, compartida entre el badge/ícono
// de pivot-table.tsx (Task 12) y la lista/línea de tiempo de
// apertura-gastos-modal.tsx (Task 11) — volumen de reglas bajo (decenas, no
// miles), sin endpoint filtrado nuevo (YAGNI).
export function useReglasApertura() {
  const { data, isLoading, error } = useFetchQuery<{ data: ReglaAperturaDTO[] }>(
    ["apertura-reglas"],
    "/api/apertura/reglas"
  );
  return { reglas: data?.data ?? [], isLoading, error };
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add lib/apertura/types.ts hooks/use-reglas-apertura.ts
git commit -m "feat(apertura-gastos): agrega DTOs y hook compartido de reglas para el frontend"
```

---

### Task 8: Componente — selector de vigencia

**Files:**
- Create: `components/dashboard/apertura-vigencia-selector.tsx`

**Interfaces:**
- Produces: `VigenciaFormState`, `ModoVigencia`, `AperturaVigenciaSelector({ value, onChange })` — consumidos por Task 11.

- [ ] **Step 1: Crear `components/dashboard/apertura-vigencia-selector.tsx`**

```tsx
"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export type ModoVigencia = "historico" | "entre_fechas" | "desde_adelante" | "desde_atras";

export interface VigenciaFormState {
  modo: ModoVigencia;
  fechaDesde: string; // yyyy-mm-dd (value de <input type="date">), "" si no aplica
  fechaHasta: string;
  extremosInclusivos: boolean;
  confirmarHistorico: boolean;
}

const MODO_LABELS: Record<ModoVigencia, string> = {
  historico: "Todos los registros (histórico completo)",
  entre_fechas: "Entre dos fechas",
  desde_adelante: "Desde una fecha en adelante",
  desde_atras: "Hasta una fecha (hacia atrás)",
};

const MODOS: ModoVigencia[] = ["historico", "entre_fechas", "desde_adelante", "desde_atras"];

export function AperturaVigenciaSelector({
  value,
  onChange,
}: {
  value: VigenciaFormState;
  onChange: (next: VigenciaFormState) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Select value={value.modo} onValueChange={(v) => onChange({ ...value, modo: v as ModoVigencia })}>
        <SelectTrigger className="h-8 w-full text-xs" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODOS.map((modo) => (
            <SelectItem key={modo} value={modo} className="text-xs">
              {MODO_LABELS[modo]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(value.modo === "entre_fechas" || value.modo === "desde_adelante") && (
        <label className="flex items-center gap-2 text-xs">
          Desde
          <Input
            type="date"
            className="h-8 w-40 text-xs"
            value={value.fechaDesde}
            onChange={(e) => onChange({ ...value, fechaDesde: e.target.value })}
          />
        </label>
      )}

      {(value.modo === "entre_fechas" || value.modo === "desde_atras") && (
        <label className="flex items-center gap-2 text-xs">
          Hasta
          <Input
            type="date"
            className="h-8 w-40 text-xs"
            value={value.fechaHasta}
            onChange={(e) => onChange({ ...value, fechaHasta: e.target.value })}
          />
        </label>
      )}

      {value.modo !== "historico" && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={value.extremosInclusivos}
            onChange={(e) => onChange({ ...value, extremosInclusivos: e.target.checked })}
          />
          Extremos inclusivos (incluye el día exacto de la fecha límite)
        </label>
      )}

      {value.modo === "historico" && (
        <label className="flex items-center gap-2 text-xs text-attention">
          <input
            type="checkbox"
            checked={value.confirmarHistorico}
            onChange={(e) => onChange({ ...value, confirmarHistorico: e.target.checked })}
          />
          Confirmo aplicar a todo el histórico de este concepto
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores. Sin test automatizado — componente de presentación puro (sin lógica de negocio propia más allá de mostrar/ocultar campos), verificado visualmente en Task 13.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/apertura-vigencia-selector.tsx
git commit -m "feat(apertura-gastos): agrega selector de vigencia del modal"
```

---

### Task 9: Componente — fila de destino (local/PDV + %/$ bidireccional)

**Files:**
- Create: `components/dashboard/apertura-destino-row.tsx`

**Interfaces:**
- Consumes: `montoDesdePct`/`pctDesdeMonto` (Task 4), `Local`/`PuntoDeVenta` (`lib/types/domain.ts`, ya existen).
- Produces: `DestinoFormState`, `AperturaDestinoRow({ destino, locales, total, onChange, onRemove, removable })` — consumido por Task 11.

- [ ] **Step 1: Crear `components/dashboard/apertura-destino-row.tsx`**

```tsx
"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { montoDesdePct, pctDesdeMonto } from "@/lib/apertura/conversion";
import type { Local } from "@/lib/types/domain";

export interface DestinoFormState {
  localId: number | null;
  puntoDeVentaId: number | null;
  porcentaje: number;
}

const TODO_EL_LOCAL = "__todo_el_local";

export function AperturaDestinoRow({
  destino,
  locales,
  total,
  onChange,
  onRemove,
  removable,
}: {
  destino: DestinoFormState;
  locales: Local[];
  total: number;
  onChange: (next: DestinoFormState) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const localSeleccionado = locales.find((l) => l.id === destino.localId);
  const puntosDeVenta = localSeleccionado?.puntosDeVenta ?? [];
  const monto = montoDesdePct(destino.porcentaje, total);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={destino.localId != null ? String(destino.localId) : ""}
        onValueChange={(v) => onChange({ ...destino, localId: Number(v), puntoDeVentaId: null })}
      >
        <SelectTrigger className="h-8 w-32 text-xs" size="sm">
          <SelectValue placeholder="Local" />
        </SelectTrigger>
        <SelectContent>
          {locales.map((l) => (
            <SelectItem key={l.id} value={String(l.id)} className="text-xs">
              {l.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={destino.puntoDeVentaId != null ? String(destino.puntoDeVentaId) : TODO_EL_LOCAL}
        onValueChange={(v) => onChange({ ...destino, puntoDeVentaId: v === TODO_EL_LOCAL ? null : Number(v) })}
        disabled={!localSeleccionado}
      >
        <SelectTrigger className="h-8 w-32 text-xs" size="sm">
          <SelectValue placeholder="Punto de venta" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODO_EL_LOCAL} className="text-xs">Todo el local</SelectItem>
          {puntosDeVenta.map((p) => (
            <SelectItem key={p.id} value={String(p.id)} className="text-xs">
              {p.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.01"
          min={0}
          max={100}
          className="h-8 w-16 text-xs text-right"
          value={destino.porcentaje}
          onChange={(e) => onChange({ ...destino, porcentaje: Number(e.target.value) || 0 })}
        />
        <span className="text-xs text-muted-foreground">%</span>
      </div>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.01"
          className="h-8 w-24 text-xs text-right"
          value={monto}
          onChange={(e) => onChange({ ...destino, porcentaje: pctDesdeMonto(Number(e.target.value) || 0, total) })}
        />
        <span className="text-xs text-muted-foreground">$</span>
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores. Sin test automatizado propio — la lógica que importa (`montoDesdePct`/`pctDesdeMonto`) ya está testeada en Task 4; verificación visual en Task 13.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/apertura-destino-row.tsx
git commit -m "feat(apertura-gastos): agrega fila de destino con selector local/PDV y %/\$ bidireccional"
```

---

### Task 10: Lógica pura + componente — línea de tiempo de superposición

**Files:**
- Create: `lib/apertura/timeline-layout.ts`
- Create: `lib/apertura/timeline-layout.test.ts`
- Create: `components/dashboard/apertura-timeline.tsx`

**Interfaces:**
- Produces: `TimelineReglaInput`, `TimelineSegmento`, `calcularSegmentosTimeline(reglas: TimelineReglaInput[]): TimelineSegmento[]` (`lib/apertura/timeline-layout.ts`); `AperturaTimeline({ reglas })` (`components/dashboard/apertura-timeline.tsx`) — consumidos por Task 11.

- [ ] **Step 1: Escribir los tests de `calcularSegmentosTimeline` (deben fallar — el módulo no existe todavía)**

```ts
// lib/apertura/timeline-layout.test.ts
import { describe, it, expect } from "vitest";
import { calcularSegmentosTimeline } from "./timeline-layout";

describe("calcularSegmentosTimeline", () => {
  it("todas historico: cada regla ocupa el 100% del ancho, sin fade", () => {
    const result = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "historico", fechaDesde: null, fechaHasta: null },
      { id: 2, estado: "inactiva", modo: "historico", fechaDesde: null, fechaHasta: null },
    ]);
    expect(result).toEqual([
      { id: 1, estado: "activa", leftPct: 0, widthPct: 100, fadeInicio: false, fadeFin: false, label: "Histórico completo" },
      { id: 2, estado: "inactiva", leftPct: 0, widthPct: 100, fadeInicio: false, fadeFin: false, label: "Histórico completo" },
    ]);
  });

  it("entre_fechas: el segmento cae dentro de (0,100), sin fade, con label de rango", () => {
    const [seg] = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-01-31") },
    ]);
    expect(seg.leftPct).toBeGreaterThan(0);
    expect(seg.leftPct).toBeLessThan(100);
    expect(seg.widthPct).toBeGreaterThan(0);
    expect(seg.fadeInicio).toBe(false);
    expect(seg.fadeFin).toBe(false);
    expect(seg.label).toBe("01/01/2026 — 31/01/2026");
  });

  it("desde_adelante: llega hasta el borde derecho (leftPct+widthPct = 100) con fade de fin", () => {
    const [seg] = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "desde_adelante", fechaDesde: new Date("2026-01-01"), fechaHasta: null },
    ]);
    expect(seg.leftPct + seg.widthPct).toBeCloseTo(100, 5);
    expect(seg.fadeFin).toBe(true);
    expect(seg.fadeInicio).toBe(false);
  });

  it("desde_atras: arranca en el borde izquierdo (leftPct=0) con fade de inicio", () => {
    const [seg] = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "desde_atras", fechaDesde: null, fechaHasta: new Date("2026-06-30") },
    ]);
    expect(seg.leftPct).toBe(0);
    expect(seg.fadeInicio).toBe(true);
    expect(seg.fadeFin).toBe(false);
  });

  it("mezcla de modos: cada segmento conserva el id/estado de su regla, en el mismo orden de entrada", () => {
    const result = calcularSegmentosTimeline([
      { id: 1, estado: "activa", modo: "entre_fechas", fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-03-31") },
      { id: "nueva", estado: "nueva", modo: "desde_adelante", fechaDesde: new Date("2026-04-01"), fechaHasta: null },
    ]);
    expect(result.map((s) => s.id)).toEqual([1, "nueva"]);
    expect(result[1].estado).toBe("nueva");
  });

  it("lista vacía devuelve lista vacía", () => {
    expect(calcularSegmentosTimeline([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run lib/apertura/timeline-layout.test.ts`
Expected: FAIL con "Cannot find module './timeline-layout'".

- [ ] **Step 3: Implementar `lib/apertura/timeline-layout.ts`**

```ts
// Calcula la posición/ancho (en %) de cada regla existente en la línea de
// tiempo visual del modal de apertura de gastos (Fase C) — puro en el sentido
// de no depender de DB/React, aunque SÍ usa Date.now() para extender el eje
// hasta "hoy" cuando todas las fechas conocidas quedaron en el pasado (así
// una regla "desde_adelante" con fecha ya vencida sigue teniendo un tramo
// visible en vez de colapsar a un punto). Por eso los tests no aseveran
// porcentajes exactos para segmentos cuyo eje depende de "hoy" — solo
// invariantes que no cambian con la fecha de ejecución.

export interface TimelineReglaInput {
  id: number | "nueva";
  estado: "activa" | "inactiva" | "nueva";
  modo: "historico" | "entre_fechas" | "desde_adelante" | "desde_atras";
  fechaDesde: Date | null;
  fechaHasta: Date | null;
}

export interface TimelineSegmento {
  id: number | "nueva";
  estado: "activa" | "inactiva" | "nueva";
  leftPct: number;
  widthPct: number;
  fadeInicio: boolean;
  fadeFin: boolean;
  label: string;
}

const DIA_MS = 24 * 60 * 60 * 1000;
const ANCHO_MINIMO_PCT = 2;

function fmt(d: Date): string {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function calcularSegmentosTimeline(reglas: TimelineReglaInput[]): TimelineSegmento[] {
  const fechasFinitas = reglas
    .flatMap((r) => [r.fechaDesde, r.fechaHasta])
    .filter((d): d is Date => d !== null);

  if (fechasFinitas.length === 0) {
    // Todas las reglas son "historico" — no hay eje temporal que dibujar,
    // cada una ocupa el ancho completo (se apilan visualmente, una fila por
    // regla, ver apertura-timeline.tsx).
    return reglas.map((r) => ({
      id: r.id,
      estado: r.estado,
      leftPct: 0,
      widthPct: 100,
      fadeInicio: false,
      fadeFin: false,
      label: "Histórico completo",
    }));
  }

  const tiempos = fechasFinitas.map((d) => d.getTime());
  const minFinito = Math.min(...tiempos);
  const maxFinito = Math.max(...tiempos, Date.now());
  const padding = Math.max((maxFinito - minFinito) * 0.05, 7 * DIA_MS);
  const inicioEje = minFinito - padding;
  const finEje = maxFinito + padding;
  const rango = finEje - inicioEje || 1;

  return reglas.map((r) => {
    if (r.modo === "historico") {
      return { id: r.id, estado: r.estado, leftPct: 0, widthPct: 100, fadeInicio: false, fadeFin: false, label: "Histórico completo" };
    }
    if (r.modo === "entre_fechas") {
      const left = ((r.fechaDesde!.getTime() - inicioEje) / rango) * 100;
      const width = Math.max(((r.fechaHasta!.getTime() - r.fechaDesde!.getTime()) / rango) * 100, ANCHO_MINIMO_PCT);
      return {
        id: r.id,
        estado: r.estado,
        leftPct: left,
        widthPct: width,
        fadeInicio: false,
        fadeFin: false,
        label: `${fmt(r.fechaDesde!)} — ${fmt(r.fechaHasta!)}`,
      };
    }
    if (r.modo === "desde_adelante") {
      const left = ((r.fechaDesde!.getTime() - inicioEje) / rango) * 100;
      return { id: r.id, estado: r.estado, leftPct: left, widthPct: 100 - left, fadeInicio: false, fadeFin: true, label: `Desde ${fmt(r.fechaDesde!)}` };
    }
    // desde_atras
    const width = ((r.fechaHasta!.getTime() - inicioEje) / rango) * 100;
    return { id: r.id, estado: r.estado, leftPct: 0, widthPct: width, fadeInicio: true, fadeFin: false, label: `Hasta ${fmt(r.fechaHasta!)}` };
  });
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run lib/apertura/timeline-layout.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Crear el componente `components/dashboard/apertura-timeline.tsx`**

```tsx
"use client";
import { calcularSegmentosTimeline, type TimelineReglaInput, type TimelineSegmento } from "@/lib/apertura/timeline-layout";

const ESTADO_CLASES: Record<TimelineReglaInput["estado"], string> = {
  activa: "bg-success/70",
  inactiva: "bg-muted-foreground/30",
  nueva: "bg-primary",
};

function maskFor(seg: TimelineSegmento): string | undefined {
  if (!seg.fadeInicio && !seg.fadeFin) return undefined;
  const inicio = seg.fadeInicio ? "transparent, black 16px" : "black 0";
  const fin = seg.fadeFin ? "black calc(100% - 16px), transparent" : "black 100%";
  return `linear-gradient(to right, ${inicio}, ${fin})`;
}

export function AperturaTimeline({ reglas }: { reglas: TimelineReglaInput[] }) {
  if (reglas.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">Sin otras reglas para este concepto todavía.</p>;
  }

  const segmentos = calcularSegmentosTimeline(reglas);

  return (
    <div className="flex flex-col gap-1.5 py-1">
      {segmentos.map((seg) => {
        const mask = maskFor(seg);
        return (
          <div key={String(seg.id)} className="flex items-center gap-2">
            <div className="relative h-4 flex-1 rounded bg-muted/50 overflow-hidden">
              <div
                className={ESTADO_CLASES[seg.estado] + " absolute inset-y-0 rounded"}
                style={{
                  left: `${seg.leftPct}%`,
                  width: `${seg.widthPct}%`,
                  maskImage: mask,
                  WebkitMaskImage: mask,
                }}
                title={seg.label}
              />
            </div>
            <span className="w-40 shrink-0 text-[11px] text-muted-foreground truncate" title={seg.label}>
              {seg.label}
              {seg.estado === "inactiva" && " · inactiva"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 7: Commit**

```bash
git add lib/apertura/timeline-layout.ts lib/apertura/timeline-layout.test.ts components/dashboard/apertura-timeline.tsx
git commit -m "feat(apertura-gastos): agrega línea de tiempo visual de superposición"
```

---

### Task 11: Componente — modal de apertura de gastos (Lista + Formulario)

**Files:**
- Create: `components/dashboard/apertura-gastos-modal.tsx`

**Interfaces:**
- Consumes: `useReglasApertura` (Task 7), `ReglaAperturaDTO`/`DestinoReglaDTO` (Task 7), `AperturaVigenciaSelector`/`VigenciaFormState` (Task 8), `AperturaDestinoRow`/`DestinoFormState` (Task 9), `AperturaTimeline`/`TimelineReglaInput` (Task 10), `validarSumaPorcentajes` (`lib/apertura/validaciones.ts`, ya existe), `GET /api/apertura/reglas/preview-total` (Task 1), `POST/PATCH/DELETE /api/apertura/reglas[/[id]]` (Fase B, ya en producción).
- Produces: `AperturaGastosModal({ conceptoCodigo, conceptoNombre, onClose })` — consumido por Task 12.

- [ ] **Step 1: Crear `components/dashboard/apertura-gastos-modal.tsx`**

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { Plus, Pencil, Trash2, Ban } from "lucide-react";
import { cn, fmtARS } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { validarSumaPorcentajes } from "@/lib/apertura/validaciones";
import type { ReglaAperturaDTO } from "@/lib/apertura/types";
import type { Local } from "@/lib/types/domain";
import type { TimelineReglaInput } from "@/lib/apertura/timeline-layout";
import { AperturaVigenciaSelector, type VigenciaFormState } from "./apertura-vigencia-selector";
import { AperturaDestinoRow, type DestinoFormState } from "./apertura-destino-row";
import { AperturaTimeline } from "./apertura-timeline";

const VIGENCIA_VACIA: VigenciaFormState = {
  modo: "historico",
  fechaDesde: "",
  fechaHasta: "",
  extremosInclusivos: true,
  confirmarHistorico: false,
};

function destinoVacio(): DestinoFormState {
  return { localId: null, puntoDeVentaId: null, porcentaje: 0 };
}

function reglaAFormulario(regla: ReglaAperturaDTO): { vigencia: VigenciaFormState; destinos: DestinoFormState[] } {
  return {
    vigencia: {
      modo: regla.modo,
      fechaDesde: regla.fechaDesde?.slice(0, 10) ?? "",
      fechaHasta: regla.fechaHasta?.slice(0, 10) ?? "",
      extremosInclusivos: regla.extremosInclusivos,
      confirmarHistorico: regla.modo === "historico",
    },
    destinos: regla.destinos.map((d) => ({
      localId: d.localId,
      puntoDeVentaId: d.puntoDeVentaId,
      porcentaje: Number(d.porcentaje),
    })),
  };
}

function fechaISOConHora(fechaInput: string): string | null {
  return fechaInput ? new Date(`${fechaInput}T00:00:00Z`).toISOString() : null;
}

function resumenVigencia(regla: ReglaAperturaDTO): string {
  switch (regla.modo) {
    case "historico": return "Histórico completo";
    case "entre_fechas": return `${regla.fechaDesde?.slice(0, 10)} — ${regla.fechaHasta?.slice(0, 10)}`;
    case "desde_adelante": return `Desde ${regla.fechaDesde?.slice(0, 10)}`;
    case "desde_atras": return `Hasta ${regla.fechaHasta?.slice(0, 10)}`;
  }
}

export function AperturaGastosModal({
  conceptoCodigo,
  conceptoNombre,
  onClose,
}: {
  conceptoCodigo: string | null;
  conceptoNombre: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"lista" | "formulario">("lista");
  const [editando, setEditando] = useState<ReglaAperturaDTO | null>(null);
  const [vigencia, setVigencia] = useState<VigenciaFormState>(VIGENCIA_VACIA);
  const [destinos, setDestinos] = useState<DestinoFormState[]>([destinoVacio(), destinoVacio()]);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [reglaAEliminar, setReglaAEliminar] = useState<ReglaAperturaDTO | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const { reglas: todasLasReglas } = useReglasApertura();
  const reglasDelConcepto = useMemo(
    () => todasLasReglas.filter((r) => r.entidadId === conceptoCodigo).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)),
    [todasLasReglas, conceptoCodigo]
  );

  const { data: localesData } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const locales = localesData ?? [];

  const vigenciaCompletaParaPreview =
    conceptoCodigo != null &&
    (vigencia.modo === "historico" ||
      (vigencia.modo === "entre_fechas" && vigencia.fechaDesde !== "" && vigencia.fechaHasta !== "") ||
      (vigencia.modo === "desde_adelante" && vigencia.fechaDesde !== "") ||
      (vigencia.modo === "desde_atras" && vigencia.fechaHasta !== ""));

  const previewUrl = vigenciaCompletaParaPreview
    ? `/api/apertura/reglas/preview-total?${new URLSearchParams({
        entidadId: conceptoCodigo!,
        modo: vigencia.modo,
        ...(vigencia.fechaDesde ? { fechaDesde: fechaISOConHora(vigencia.fechaDesde)! } : {}),
        ...(vigencia.fechaHasta ? { fechaHasta: fechaISOConHora(vigencia.fechaHasta)! } : {}),
        extremosInclusivos: String(vigencia.extremosInclusivos),
      }).toString()}`
    : null;

  const { data: previewData, isLoading: previewLoading } = useFetchQuery<{ total: number }>(
    ["apertura-preview-total", conceptoCodigo, vigencia.modo, vigencia.fechaDesde, vigencia.fechaHasta, vigencia.extremosInclusivos],
    previewUrl,
    { staleTime: 10_000 }
  );
  const total = previewData?.total ?? 0;

  useEffect(() => {
    if (conceptoCodigo === null) {
      setView("lista");
      setEditando(null);
      setErrorGuardar(null);
    }
  }, [conceptoCodigo]);

  function abrirFormularioNuevo() {
    setEditando(null);
    setVigencia(VIGENCIA_VACIA);
    setDestinos([destinoVacio(), destinoVacio()]);
    setErrorGuardar(null);
    setView("formulario");
  }

  function abrirFormularioEditar(regla: ReglaAperturaDTO) {
    const { vigencia: v, destinos: d } = reglaAFormulario(regla);
    setEditando(regla);
    setVigencia(v);
    setDestinos(d);
    setErrorGuardar(null);
    setView("formulario");
  }

  const sumaPorcentajes = destinos.reduce((acc, d) => acc + d.porcentaje, 0);
  const sumaValida = validarSumaPorcentajes(destinos);

  async function refetchDependientes() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["apertura-reglas"] }),
      queryClient.invalidateQueries({ queryKey: ["pivot"] }),
      queryClient.invalidateQueries({ queryKey: ["detalle"] }),
    ]);
  }

  async function handleGuardar() {
    if (conceptoCodigo === null) return;
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const cuerpoComun = {
        modo: vigencia.modo,
        fechaDesde: fechaISOConHora(vigencia.fechaDesde),
        fechaHasta: fechaISOConHora(vigencia.fechaHasta),
        extremosInclusivos: vigencia.extremosInclusivos,
        confirmarHistorico: vigencia.modo === "historico" ? vigencia.confirmarHistorico : undefined,
        destinos: destinos.map((d) => ({ localId: d.localId, puntoDeVentaId: d.puntoDeVentaId, porcentaje: d.porcentaje })),
      };

      const res = editando
        ? await fetch(`/api/apertura/reglas/${editando.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accion: "editar", ...cuerpoComun }),
          })
        : await fetch("/api/apertura/reglas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entidadId: conceptoCodigo, ...cuerpoComun }),
          });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        if (res.status === 409) {
          setErrorGuardar(payload?.error ?? "Esta vigencia se superpone con otra regla activa del mismo concepto.");
        } else if (res.status === 422) {
          setErrorGuardar(payload?.issues?.[0]?.message ?? "Datos inválidos.");
        } else {
          setErrorGuardar("No se pudo guardar. Intentá de nuevo.");
        }
        return;
      }

      await refetchDependientes();
      notify.registroActualizado();
      setView("lista");
    } catch {
      setErrorGuardar("No se pudo guardar. Intentá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  async function handleDesactivar(regla: ReglaAperturaDTO) {
    try {
      const res = await fetch(`/api/apertura/reglas/${regla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "desactivar" }),
      });
      if (!res.ok) throw new Error();
      await refetchDependientes();
      notify.registroActualizado();
    } catch {
      notify.errorActualizar(conceptoNombre);
    }
  }

  async function handleEliminar() {
    if (!reglaAEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/apertura/reglas/${reglaAEliminar.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await refetchDependientes();
      notify.registroActualizado();
      setReglaAEliminar(null);
    } catch {
      notify.errorActualizar(conceptoNombre);
    } finally {
      setEliminando(false);
    }
  }

  const reglasParaTimeline: TimelineReglaInput[] = [
    ...reglasDelConcepto
      .filter((r) => editando === null || r.id !== editando.id)
      .map((r) => ({
        id: r.id,
        estado: r.estado,
        modo: r.modo,
        fechaDesde: r.fechaDesde ? new Date(r.fechaDesde) : null,
        fechaHasta: r.fechaHasta ? new Date(r.fechaHasta) : null,
      })),
    ...(view === "formulario"
      ? [
          {
            id: "nueva" as const,
            estado: "nueva" as const,
            modo: vigencia.modo,
            fechaDesde: vigencia.fechaDesde ? new Date(vigencia.fechaDesde) : null,
            fechaHasta: vigencia.fechaHasta ? new Date(vigencia.fechaHasta) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <Dialog open={conceptoCodigo !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Apertura de gastos — {conceptoNombre}</DialogTitle>
          </DialogHeader>

          {view === "lista" && (
            <div className="flex flex-col gap-2">
              {reglasDelConcepto.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Este concepto todavía no tiene reglas de apertura.
                </p>
              )}
              {reglasDelConcepto.map((regla) => (
                <div key={regla.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={regla.estado === "activa" ? "default" : "outline"}>
                        {regla.estado === "activa" ? "Activa" : "Inactiva"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {regla.destinos.length} destino{regla.destinos.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">{resumenVigencia(regla)}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      title="Editar"
                      onClick={() => abrirFormularioEditar(regla)}
                      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {regla.estado === "activa" && (
                      <button
                        type="button"
                        title="Desactivar"
                        onClick={() => handleDesactivar(regla)}
                        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Eliminar"
                      onClick={() => setReglaAEliminar(regla)}
                      className="flex h-7 w-7 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={abrirFormularioNuevo}
                className="mt-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md border text-xs hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" /> Nueva regla
              </button>
            </div>
          )}

          {view === "formulario" && (
            <div className="flex flex-col gap-3">
              <AperturaVigenciaSelector value={vigencia} onChange={setVigencia} />

              {reglasParaTimeline.length > 0 && <AperturaTimeline reglas={reglasParaTimeline} />}

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Destinos</span>
                  <span>Total del período: {previewLoading ? "…" : fmtARS(total)}</span>
                </div>
                {destinos.map((d, i) => (
                  <AperturaDestinoRow
                    key={i}
                    destino={d}
                    locales={locales}
                    total={total}
                    removable={destinos.length > 1}
                    onChange={(next) => setDestinos((prev) => prev.map((p, idx) => (idx === i ? next : p)))}
                    onRemove={() => setDestinos((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setDestinos((prev) => [...prev, destinoVacio()])}
                  className="self-start inline-flex items-center gap-1 h-6 px-2 rounded text-xs text-muted-foreground hover:bg-muted"
                >
                  <Plus className="h-3 w-3" /> Agregar destino
                </button>
                <p className={cn("text-xs font-medium", sumaValida ? "text-success" : "text-destructive")}>
                  Suma: {sumaPorcentajes.toFixed(2)}% {sumaValida ? "" : "(debe dar 100%)"}
                </p>
              </div>

              {errorGuardar && <p className="text-xs text-destructive">{errorGuardar}</p>}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setView("lista")}
                  disabled={guardando}
                  className="h-8 px-3 rounded-md border text-xs hover:bg-muted disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleGuardar}
                  disabled={guardando || !sumaValida || (vigencia.modo === "historico" && !vigencia.confirmarHistorico)}
                  className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-1.5"
                >
                  {guardando && <Spinner size="sm" className="text-primary-foreground" />}
                  {editando ? "Guardar cambios" : "Crear regla"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={reglaAEliminar !== null}
        onOpenChange={(o) => { if (!o) setReglaAEliminar(null); }}
        title="Eliminar regla de apertura"
        description="Se revertirán todas las distribuciones ya generadas por esta regla. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        destructive
        confirming={eliminando}
        onConfirm={handleEliminar}
      />
    </>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores. Sin test automatizado — orquesta fetches reales a rutas que tocan DB, mismo criterio que el resto de los modales del dashboard (`rubros-config-modal.tsx`, `compras-detalle-modal.tsx`, ninguno tiene test de componente); verificación funcional completa en Task 13.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/apertura-gastos-modal.tsx
git commit -m "feat(apertura-gastos): agrega modal de creación/edición/gestión de reglas"
```

---

### Task 12: Wire-up — ícono + indicador visual en `pivot-table.tsx`

**Files:**
- Modify: `components/ui/expandable-button.tsx`
- Modify: `components/dashboard/pivot-table.tsx`

**Interfaces:**
- Consumes: `useReglasApertura` (Task 7), `AperturaGastosModal` (Task 11).
- Produces: nada nuevo — cierra la integración visual (ícono de acceso + badge 2.9).

- [ ] **Step 1: Agregar `className` opcional a `ExpandableButton`**

`components/ui/expandable-button.tsx` pasa de:

```tsx
interface ExpandableButtonProps {
  isExpanded: boolean;
  onClick: () => void;
  children: React.ReactNode;
  indent?: string;
  iconSize?: string;
}

export function ExpandableButton({
  isExpanded,
  onClick,
  children,
  indent,
  iconSize = "w-4 h-4",
}: ExpandableButtonProps) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        indent
      )}
      onClick={onClick}
      aria-expanded={isExpanded}
    >
```

a:

```tsx
interface ExpandableButtonProps {
  isExpanded: boolean;
  onClick: () => void;
  children: React.ReactNode;
  indent?: string;
  iconSize?: string;
  className?: string;
}

export function ExpandableButton({
  isExpanded,
  onClick,
  children,
  indent,
  iconSize = "w-4 h-4",
  className,
}: ExpandableButtonProps) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        indent,
        className
      )}
      onClick={onClick}
      aria-expanded={isExpanded}
    >
```

- [ ] **Step 2: Agregar imports y estado nuevo en `pivot-table.tsx`**

El import de React pasa de `import { useState } from "react";` a `import { useMemo, useState } from "react";`.

Agregar imports nuevos (junto a los ya existentes):

```tsx
import { Split } from "lucide-react";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { AperturaGastosModal } from "./apertura-gastos-modal";
```

Dentro de `PivotTable`, junto a los demás `useState`, agregar:

```tsx
  const [aperturaConcepto, setAperturaConcepto] = useState<{ codigo: string; nombre: string } | null>(null);
  const { reglas } = useReglasApertura();
  const conceptosConReglaActiva = useMemo(
    () => new Set(reglas.filter((r) => r.estado === "activa").map((r) => r.entidadId)),
    [reglas]
  );
```

- [ ] **Step 3: Agregar el ícono + badge en la celda de nivel-concepto**

La celda (dentro del branch `item.type === "concepto"`) pasa de:

```tsx
                    <td className="sticky left-0 z-10 bg-background px-4 py-2 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <ExpandableButton isExpanded={isExpanded} onClick={() => toggleRow(concepto.id)} indent="pl-5" iconSize="w-3.5 h-3.5">
                        {concepto.nombre}
                      </ExpandableButton>
                    </td>
```

a:

```tsx
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
                      </div>
                    </td>
```

- [ ] **Step 4: Montar el modal**

Junto a `<ComprasDetalleModal .../>` y `<VentasDetalleModal .../>` (al final del JSX de `PivotTable`), agregar:

```tsx
      <AperturaGastosModal
        conceptoCodigo={aperturaConcepto?.codigo ?? null}
        conceptoNombre={aperturaConcepto?.nombre ?? ""}
        onClose={() => setAperturaConcepto(null)}
      />
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add components/ui/expandable-button.tsx components/dashboard/pivot-table.tsx
git commit -m "feat(apertura-gastos): agrega ícono de acceso e indicador visual (2.9) en pivot-table"
```

---

### Task 13: Verificación final y aplicación gateada (controller, no subagente)

**Esta task la ejecuta el controller directamente en conversación con el usuario — NO se dispatchea a un subagente.** CLAUDE.md sección 7 excluye explícitamente cualquier cambio que toque compras/ventas ya importadas (acá: la regla de prueba real que se crea/revierte) de la ejecución autónoma de `subagent-driven-development`. La aprobación de arranque de este plan ya cubre esta task (excepción de sección 7), pero cualquier resultado inesperado (colisión, verificación fallida, exit code ≠ 0) para la ejecución y se avisa — igual criterio que Fase A/B.

**Files:** ninguno nuevo — solo verificación.

**Interfaces:** ninguna — consume todo lo construido en Tasks 1-12.

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: 0 errores.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build exitoso (incluye `prisma generate` + type-check completo de Next).

- [ ] **Step 3: Tests**

Run: `npm test`
Expected: todos PASS — el suite existente (231 tests a la fecha de Fase B) más los nuevos de este plan (`schemas.test.ts` +5, `conversion.test.ts` 9, `timeline-layout.test.ts` 6 — 251 en total).

- [ ] **Step 4: Levantar el dashboard y probar la UI en un browser real**

CLAUDE.md ("Executing actions") pide probar cambios de frontend en un browser antes de dar la tarea por completa — a diferencia de Fase A/B (sin UI), Fase C sí la tiene, así que este paso es obligatorio, no opcional.

Run: `npm run dev` (en background) y abrir el dashboard de Compras en un browser.

Recorrido a verificar (sin crear todavía ninguna regla real — solo UI):
- El ícono de apertura (▸ split) aparece junto a cada nombre de concepto, sin badge activo (todavía no hay reglas).
- Click en el ícono abre el modal, vista "Lista", con el mensaje de "todavía no tiene reglas".
- "+ Nueva regla" abre el formulario: cambiar el modo de vigencia muestra/oculta los campos de fecha correctamente (los 4 modos); en modo "histórico" aparece el checkbox de confirmación y el botón "Crear regla" queda deshabilitado hasta tildarlo.
- Agregar/quitar destinos funciona; el total no puede bajar de 1 destino.
- El campo % y el campo $ de un destino se actualizan entre sí correctamente (cambiar uno recalcula el otro).
- El indicador de "Suma: X%" cambia de rojo a verde al llegar a 100%.

- [ ] **Step 5: Backup manual antes de tocar datos**

Run: `pg_dump` del schema `public` (mismo patrón que Fase A/B) a un archivo local gitignored, ej. `backups/pre-apertura-fase-c-<timestamp>.sql`.

- [ ] **Step 6: Crear una regla de prueba de bajo riesgo desde la UI real**

Elegir un concepto/local/PDV de bajo riesgo (mismo criterio de discreción que Fase B — evitar tocar un concepto con volumen relevante; no reusar el concepto `26` señalado en Fase B con ruido de punto flotante en `importeManual`). Crear una regla con 2 destinos (60/40) en modo `entre_fechas` sobre un rango chico, **desde el modal real**, no desde un script.

Confirmar en el browser:
- El total del período mostrado en el formulario coincide con lo esperado.
- Al guardar, la regla aparece en la vista Lista como "Activa".
- El ícono del concepto en `pivot-table.tsx` ahora muestra el badge activo (color primario).
- Abrir el detalle de ese concepto (`pivot` → drill-down): las filas de la compra aparecen 2 veces (una por destino), sin warning de key duplicada en la consola del browser, con importes parciales correctos que suman el original.
- En `compras-detalle-modal.tsx`, las filas distribuidas muestran el ícono de editar/ver-líneas deshabilitado con el tooltip correspondiente.

- [ ] **Step 7: Verificar edición y reactivación**

Desde la vista Lista, "Desactivar" la regla → confirmar que pasa a "Inactiva" y desaparece el badge del concepto en `pivot-table.tsx` (recargar o esperar el refetch). "Editar" esa misma regla inactiva (sin cambiar nada o con un cambio menor) y guardar → confirmar que vuelve a "Activa" (Task 2) sin haber usado ningún botón "Activar" separado (no existe).

- [ ] **Step 8: Revertir por completo**

Desde la vista Lista, "Eliminar" la regla (confirmar en el `ConfirmDialog`). Confirmar en el browser que:
- El badge desaparece del concepto.
- El drill-down vuelve a mostrar una sola fila con el importe original completo.
- `git diff`/conteos en base (mismo patrón que Fase A/B: contar filas de `distribuciones_apertura`, `esDistribuido` de la compra de prueba) confirman reversión total — 0 residuos.

Si cualquier paso de Steps 6-8 da un resultado distinto al esperado (colisión, badge que no aparece/desaparece, importe que no cuadra, consola con errores), **detenerse acá y avisar** — no continuar ni intentar "arreglar en caliente" contra producción.

- [ ] **Step 9: Actualizar memoria del proyecto**

Documentar en `/Users/imanolalvarez/.claude/projects/-Users-imanolalvarez-Documents-lazarillo-gestion/memory/project_apertura_gastos_fase_c_estado.md` (nuevo archivo, mismo formato que `project_apertura_gastos_fase_b_estado.md`): qué se aplicó, qué se verificó en el browser real (a diferencia de Fase A/B, acá sí hubo verificación de UI), y actualizar el índice en `MEMORY.md`. Mencionar explícitamente que el límite conocido #1 de Fase B (ninguna regla real activa hasta Fase D) sigue vigente — Fase C construyó la UI para administrar reglas, pero la política de no usarlas en producción real no cambia hasta que Fase D cierre el gap de overrides manuales.

- [ ] **Step 10: Commit final si Step 9 generó cambios fuera de memoria (no debería — memoria vive fuera del repo)**

No aplica commit de código en esta task — Tasks 1-12 ya quedaron commiteadas individualmente. Este step es solo para confirmar `git status` limpio antes de pasar a `finishing-a-development-branch`.

Run: `git status`
Expected: working tree limpio (sin cambios sin commitear).
