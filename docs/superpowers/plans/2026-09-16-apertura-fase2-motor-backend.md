# Apertura de Gastos Fase 2 — Motor + Backend (Plan 1 de 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalizar el motor de reglas de apertura (`lib/apertura/`) de nivel único `concepto` a los 3 niveles de la spec v2 (`concepto`/`proveedor`/`registro`), con prioridad `registro > proveedor > concepto` resuelta en escritura, sin romper ningún comportamiento existente de nivel `concepto`.

**Architecture:** El schema ya es genérico (`entidadId`/`nivel`), no hay migración. El punto central es que hoy una compra queda "bloqueada" (`esDistribuido = true`) para cualquier otra regla en cuanto una la reclama — un candado de exclusividad, no solo un dato. Generalizar a 3 niveles agrega: (1) un predicado de matching por nivel (`condicionMatchNivel`), (2) un paso nuevo (`liberarComprasReclamables`) que libera puntualmente compras tomadas por una regla de *menor* prioridad antes de que una de mayor prioridad las reclame, (3) un loop compartido y ordenado por prioridad (`reaplicarReglasActivas`) reusado tanto por reimportación como por la cascada de "eliminar regla", y (4) generalizar `reevaluarCompra` para buscar candidatas en los 3 niveles en orden de prioridad. Este plan es **solo el motor y las rutas de API** — la UI (ícono "Aperturar" en proveedor/registro individual, modal parametrizado) es un plan separado que arranca una vez este esté verificado.

**Tech Stack:** TypeScript estricto, Prisma 7 (`$queryRaw`/`$executeRaw`), Zod, Next.js API routes, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-apertura-fase2-proveedor-registro-design.md`

## Global Constraints

- Prioridad fija: `registro > proveedor > concepto` (spec v2, no negociable).
- Ningún cambio de schema/migración — `ReglaApertura.entidadId`/`nivel` ya son genéricos.
- `entidadId` por nivel: `concepto` → código de `ConceptoCaja`; `proveedor` → `String(proveedor.id)`; `registro` → `compra.rowId`.
- Nivel `registro` no admite vigencia — internamente se implementa como `modo: "historico"` sin necesitar campos nuevos en el schema; se valida explícitamente que un `nivel: "registro"` solo pueda guardarse con `modo: "historico"`.
- Compatibilidad hacia atrás obligatoria: la UI actual (nivel concepto, sin campo `nivel` en sus requests) no cambia hasta el Plan 2 — todo campo `nivel` nuevo en los schemas de Zod debe tener `default("concepto")`, para que ningún request existente se rompa entre este plan y el de UI.
- Ningún `catch {}` vacío; toda operación de aplicar/revertir corre dentro de `$transaction` (ya es el patrón existente, no cambia).
- Este repo **no tiene tests de integración contra DB real** para `aplicarRegla`/`condicionComprasElegibles`/etc. — solo la lógica pura (`calcularDistribuciones`, `validaciones.ts`, `vigencia.ts`, `elegirReglaParaCompra`) tiene unit tests. Seguir el mismo patrón: la lógica pura nueva se testea, la orquestación contra DB se verifica manualmente contra datos reales (Task 6).
- **CLAUDE.md sección 7**: cualquier paso que corra el motor contra la base de producción real requiere confirmación explícita del usuario antes de ejecutarse — no autónomo bajo ningún subagente.

---

### Task 1: `condicionMatchNivel` + generalizar `condicionComprasElegibles` + `nivel` en los schemas

**Files:**
- Modify: `lib/apertura/motor.ts:145-191` (`condicionComprasElegibles`)
- Modify: `lib/apertura/schemas.ts` (`crearReglaSchema`, `previewTotalQuerySchema`)
- Modify: `app/api/apertura/reglas/preview-total/route.ts` (pasar `nivel` a `condicionComprasElegibles`)
- Test: `lib/apertura/schemas.test.ts`

**Interfaces:**
- Produces: `condicionComprasElegibles(nivel: string, entidadId: string, vigenciaSql: Prisma.Sql, origen: {...}, reglaEnEdicionId?: number | null): Prisma.Sql` (agrega `nivel` como primer parámetro — firma distinta a la actual). `PRIORIDAD_NIVEL: Record<string, number>` exportado desde `motor.ts`, usado por Tasks 3 y 4.
- Consumes: nada de tareas anteriores.

- [ ] **Step 1: Agregar `PRIORIDAD_NIVEL` y `condicionMatchNivel` en `lib/apertura/motor.ts`**

Agregar, antes de `condicionComprasElegibles` (después del import de `encontrarSuperposicion, origenesSuperpuestos`):

```ts
// Orden fijo de prioridad cuando una compra matchea reglas de más de un
// nivel — spec v2 sección 2, no negociable. Número más alto = gana.
export const PRIORIDAD_NIVEL: Record<string, number> = {
  registro: 3,
  proveedor: 2,
  concepto: 1,
};

// Predicado de matching por nivel — hasta Fase 2 estaba hardcodeado a
// concepto dentro de condicionComprasElegibles. proveedorId es Int en
// compras, entidadId siempre es String — el cast ::text deja que un
// proveedorId null nunca matchee (null::text = cualquier cosa es null,
// osea false), igual que hoy pasa con conceptoCodigo ausente.
function condicionMatchNivel(nivel: string, entidadId: string): Prisma.Sql {
  if (nivel === "proveedor") return Prisma.sql`c."proveedorId"::text = ${entidadId}`;
  if (nivel === "registro") return Prisma.sql`c."rowId" = ${entidadId}`;
  return Prisma.sql`COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${entidadId}`;
}
```

- [ ] **Step 2: Generalizar `condicionComprasElegibles` para recibir `nivel`**

Reemplazar la firma y el `WHERE` de `condicionComprasElegibles` (agregar `nivel` como primer parámetro, usar `condicionMatchNivel` en vez del `COALESCE` hardcodeado):

```ts
export function condicionComprasElegibles(
  nivel: string,
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

  const filtroOrigen =
    origen.origenPuntoDeVentaId != null
      ? Prisma.sql`c."puntoDeVentaId" = ${origen.origenPuntoDeVentaId}`
      : Prisma.sql`c."localId" = ${origen.origenLocalId}`;

  return Prisma.sql`
    SELECT c."rowId", COALESCE(c."importeManual", c.importe) AS "importeBase"
    FROM compras c
    WHERE ${condicionMatchNivel(nivel, entidadId)}
      AND c."esBloqueado" = false
      AND ${filtroDistribuido}
      AND ${filtroOrigen}
      AND COALESCE(c."importeManual", c.importe) IS NOT NULL
      AND (${vigenciaSql})
  `;
}
```

- [ ] **Step 3: Actualizar el call site dentro de `aplicarRegla` (mismo archivo)**

`aplicarRegla` ya recibe `input.entidadId` — agregar `input.nivel: string` a `AplicarReglaInput` y pasarlo:

```ts
interface AplicarReglaInput {
  reglaId: number;
  nivel: string;
  entidadId: string;
  vigencia: ReglaVigencia;
  destinos: DestinoPct[];
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null };
}
```

Y en el cuerpo de `aplicarRegla`, cambiar:
```ts
condicionComprasElegibles(input.entidadId, vigenciaSql, input.origen)
```
por:
```ts
condicionComprasElegibles(input.nivel, input.entidadId, vigenciaSql, input.origen)
```

- [ ] **Step 4: Agregar `nivel` a los schemas (crear + preview), con default `"concepto"` y validación de vigencia para `registro`**

En `lib/apertura/schemas.ts`, agregar antes de `crearReglaSchema`:

```ts
export const nivelReglaSchema = z.enum(["concepto", "proveedor", "registro"]).default("concepto");
```

Reemplazar `crearReglaSchema`:

```ts
export const crearReglaSchema = z
  .object({
    nivel: nivelReglaSchema,
    entidadId: z.string().min(1).max(50),
    ...camposVigencia,
  })
  .superRefine((data, ctx) => {
    validarCuerpoRegla(data, ctx);
    if (data.nivel === "registro" && data.modo !== "historico") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "nivel 'registro' no admite vigencia — modo debe ser 'historico'",
        path: ["modo"],
      });
    }
  });
```

Reemplazar `previewTotalQuerySchema`:

```ts
export const previewTotalQuerySchema = z
  .object({
    nivel: nivelReglaSchema,
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

(`patchReglaSchema` NO cambia — el nivel de una regla existente es inmutable, la ruta de edición lo lee de la fila ya guardada, ver Task 2.)

- [ ] **Step 5: Pasar `nivel` en `GET /api/apertura/reglas/preview-total`**

En `app/api/apertura/reglas/preview-total/route.ts`, agregar `nivel: searchParams.get("nivel") ?? undefined` al objeto que se le pasa a `previewTotalQuerySchema.safeParse`, desestructurar `nivel` de `parsed.data`, y pasarlo como primer argumento a `condicionComprasElegibles`:

```ts
const parsed = previewTotalQuerySchema.safeParse({
  nivel: searchParams.get("nivel") ?? undefined,
  entidadId: searchParams.get("entidadId") ?? undefined,
  reglaId: searchParams.get("reglaId") ?? undefined,
  origenLocalId: searchParams.get("origenLocalId") ?? undefined,
  origenPuntoDeVentaId: searchParams.get("origenPuntoDeVentaId") ?? undefined,
  modo: searchParams.get("modo") ?? undefined,
  fechaDesde: searchParams.get("fechaDesde") ?? undefined,
  fechaHasta: searchParams.get("fechaHasta") ?? undefined,
  extremosInclusivos: searchParams.get("extremosInclusivos") !== "false",
});
```

```ts
const { nivel, entidadId, reglaId, origenLocalId, origenPuntoDeVentaId, modo, fechaDesde, fechaHasta, extremosInclusivos } =
  parsed.data;
```

```ts
FROM (${condicionComprasElegibles(
  nivel,
  entidadId,
  vigenciaSql,
  { origenLocalId: origenLocalId ?? null, origenPuntoDeVentaId: origenPuntoDeVentaId ?? null },
  reglaId ?? null
)}) sub
```

- [ ] **Step 6: Escribir los tests que fallan para la validación nueva**

Agregar a `lib/apertura/schemas.test.ts` (si el archivo no tiene ya un `describe("crearReglaSchema"`, crear uno):

```ts
describe("crearReglaSchema — nivel", () => {
  const base = {
    entidadId: "48",
    origenLocalId: 1,
    destinos: [{ localId: 1, porcentaje: 100 }],
  };

  it("default de nivel es 'concepto' si se omite (compatibilidad hacia atrás)", () => {
    const r = crearReglaSchema.safeParse({ ...base, modo: "historico", confirmarHistorico: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nivel).toBe("concepto");
  });

  it("nivel 'registro' con modo 'historico' es válido", () => {
    const r = crearReglaSchema.safeParse({
      ...base, nivel: "registro", modo: "historico", confirmarHistorico: true,
    });
    expect(r.success).toBe(true);
  });

  it("nivel 'registro' con modo distinto de 'historico' es inválido", () => {
    const r = crearReglaSchema.safeParse({
      ...base, nivel: "registro", modo: "desde_adelante", fechaDesde: "2026-01-01T00:00:00Z",
    });
    expect(r.success).toBe(false);
  });

  it("nivel 'proveedor' admite cualquier modo de vigencia, igual que concepto", () => {
    const r = crearReglaSchema.safeParse({
      ...base, nivel: "proveedor", entidadId: "123", modo: "desde_adelante", fechaDesde: "2026-01-01T00:00:00Z",
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 7: Correr los tests y verificar que fallan primero, luego pasan**

Run: `npx vitest run lib/apertura/schemas.test.ts`
Expected antes del Step 4/5: FAIL (nivel no existe en el schema, `r.data.nivel` sería undefined). Después: PASS (4 tests nuevos).

- [ ] **Step 8: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: todo en verde. `condicionComprasElegibles` cambió de firma — si hay algún otro call site no contemplado, `tsc` lo va a marcar acá.

- [ ] **Step 9: Commit**

```bash
git add lib/apertura/motor.ts lib/apertura/schemas.ts lib/apertura/schemas.test.ts "app/api/apertura/reglas/preview-total/route.ts"
git commit -m "feat(apertura): agrega nivel a condicionComprasElegibles y a los schemas

condicionMatchNivel generaliza el predicado de matching (antes hardcodeado
a concepto). nivel tiene default 'concepto' en los schemas para no romper
la UI actual, que todavía no lo envía. registro no admite vigencia —
validado explícitamente (debe ser modo: historico).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `verificarSinSuperposicion` por nivel + `nivel` en las rutas de crear/editar

**Files:**
- Modify: `lib/apertura/motor.ts:100-143` (`verificarSinSuperposicion`)
- Modify: `app/api/apertura/reglas/route.ts` (POST)
- Modify: `app/api/apertura/reglas/[id]/route.ts` (PATCH)

**Interfaces:**
- Consumes: `PRIORIDAD_NIVEL` no se usa en esta tarea todavía (llega en Task 3/4).
- Produces: `verificarSinSuperposicion(prisma, nivel, entidadId, vigenciaNueva, origenNuevo, excluirId?)` — agrega `nivel` como segundo parámetro (firma distinta a la actual). POST ahora persiste `nivel: parsed.data.nivel` en vez de literal `"concepto"`.

- [ ] **Step 1: Generalizar `verificarSinSuperposicion`**

En `lib/apertura/motor.ts`, cambiar la firma y el `where` del `findMany`:

```ts
export async function verificarSinSuperposicion(
  prisma: AperturaDbClient,
  nivel: string,
  entidadId: string,
  vigenciaNueva: ReglaVigencia,
  origenNuevo: { localId: number | null; puntoDeVentaId: number | null },
  excluirId?: number
): Promise<void> {
  const existentes = await prisma.reglaApertura.findMany({
    where: {
      entidadId,
      nivel,
      estado: "activa",
      ...(excluirId != null ? { NOT: { id: excluirId } } : {}),
    },
    select: {
      id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true,
      origenLocalId: true, origenPuntoDeVentaId: true,
    },
  });
  // ... resto sin cambios (conOrigenSolapado, encontrarSuperposicion, throw)
```

- [ ] **Step 2: Actualizar `POST /api/apertura/reglas`**

En `app/api/apertura/reglas/route.ts`, desestructurar `nivel` de `parsed.data` (junto a `entidadId, modo, ...`), pasar `nivel` a `verificarSinSuperposicion`, y usar `nivel` en vez del literal al crear:

```ts
const { nivel, entidadId, modo, fechaDesde, fechaHasta, extremosInclusivos, origenLocalId, origenPuntoDeVentaId, destinos } =
  parsed.data;
```

```ts
await verificarSinSuperposicion(tx, nivel, entidadId, vigenciaNueva, {
  localId: origen.origenLocalId,
  puntoDeVentaId: origen.origenPuntoDeVentaId,
});
```

```ts
const regla = await tx.reglaApertura.create({
  data: {
    nivel,
    entidadId,
    // ... resto sin cambios
```

Y en la llamada a `aplicarRegla` más abajo en el mismo handler, agregar `nivel`:

```ts
const resultado = await aplicarRegla(tx, {
  reglaId: regla.id,
  nivel,
  entidadId,
  vigencia: vigenciaNueva,
  origen: { origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId },
  destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
});
```

- [ ] **Step 3: Actualizar `PATCH /api/apertura/reglas/[id]`**

En `app/api/apertura/reglas/[id]/route.ts`, el nivel de una regla existente nunca cambia — usar `existente.nivel` (ya disponible, viene del `findUnique` que ya corre al principio del handler):

```ts
await verificarSinSuperposicion(
  tx,
  existente.nivel,
  existente.entidadId,
  vigenciaNueva,
  { localId: origen.origenLocalId, puntoDeVentaId: origen.origenPuntoDeVentaId },
  id
);
```

Y en la llamada a `aplicarRegla` más abajo en el mismo handler:

```ts
const resultado = await aplicarRegla(tx, {
  reglaId: regla.id,
  nivel: existente.nivel,
  entidadId: existente.entidadId,
  vigencia: vigenciaNueva,
  origen: { origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId },
  destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
});
```

- [ ] **Step 4: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/motor.ts "app/api/apertura/reglas/route.ts" "app/api/apertura/reglas/[id]/route.ts"
git commit -m "refactor(apertura): verificarSinSuperposicion y aplicarRegla reciben nivel explícito

POST persiste el nivel elegido; PATCH reusa el de la fila existente (es
inmutable). Antes verificarSinSuperposicion hardcodeaba nivel: concepto,
lo que hubiera dejado colisionar dos reglas de proveedor/registro sin
detectarlo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `liberarComprasReclamables` — ceder compras de menor prioridad

**Files:**
- Modify: `lib/apertura/motor.ts` (nueva función)
- Modify: `app/api/apertura/reglas/route.ts` (POST — llamar antes de `aplicarRegla`)
- Modify: `app/api/apertura/reglas/[id]/route.ts` (PATCH-editar — llamar antes de `aplicarRegla`)

**Interfaces:**
- Consumes: `PRIORIDAD_NIVEL`, `condicionMatchNivel`-equivalente (reimplementado inline, ver Step 1), `revertirCompras` (ya existe en `motor.ts`).
- Produces: `liberarComprasReclamables(prisma, nivel, entidadId, vigenciaSql, origen): Promise<void>`.

- [ ] **Step 1: Implementar `liberarComprasReclamables` en `lib/apertura/motor.ts`**

Agregar después de `condicionComprasElegibles`:

```ts
// Antes de que una regla de mayor prioridad reclame compras, hay que ceder
// las que ya estaban tomadas por una regla de MENOR prioridad — aplicarRegla
// nunca las hubiera tocado por su cuenta (su WHERE exige esDistribuido =
// false). No hace nada si `nivel` es la prioridad más baja (concepto): no hay
// nada de dónde ceder, y el comportamiento de v1 queda intacto.
export async function liberarComprasReclamables(
  prisma: AperturaDbClient,
  nivel: string,
  entidadId: string,
  vigenciaSql: Prisma.Sql,
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null }
): Promise<void> {
  const prioridadNueva = PRIORIDAD_NIVEL[nivel];
  const nivelesMenores = Object.entries(PRIORIDAD_NIVEL)
    .filter(([, p]) => p < prioridadNueva)
    .map(([n]) => n);
  if (nivelesMenores.length === 0) return;

  const filtroOrigen =
    origen.origenPuntoDeVentaId != null
      ? Prisma.sql`c."puntoDeVentaId" = ${origen.origenPuntoDeVentaId}`
      : Prisma.sql`c."localId" = ${origen.origenLocalId}`;

  const filas = await prisma.$queryRaw<{ rowId: string }[]>(Prisma.sql`
    SELECT DISTINCT c."rowId"
    FROM compras c
    JOIN distribuciones_apertura da ON da."compraRowId" = c."rowId"
    JOIN reglas_apertura ra          ON ra.id = da."reglaId"
    WHERE ${condicionMatchNivel(nivel, entidadId)}
      AND c."esBloqueado" = false
      AND ${filtroOrigen}
      AND COALESCE(c."importeManual", c.importe) IS NOT NULL
      AND (${vigenciaSql})
      AND ra.nivel = ANY(${nivelesMenores}::text[])
  `);

  if (filas.length > 0) await revertirCompras(prisma, filas.map((f) => f.rowId));
}
```

`condicionMatchNivel` está declarada sin `export` en Task 1 — quitarle el `export` no hace falta (nunca lo tuvo), pero si el linter marca "unused" en algún punto intermedio, no aplica acá porque ya se usa en `condicionComprasElegibles` desde Task 1.

- [ ] **Step 2: Llamar `liberarComprasReclamables` antes de `aplicarRegla` en `POST /api/apertura/reglas`**

En `app/api/apertura/reglas/route.ts`, importar `liberarComprasReclamables` desde `@/lib/apertura/motor`, y agregar la llamada dentro de la transacción, inmediatamente antes de `const resultado = await aplicarRegla(tx, {...})`:

```ts
await liberarComprasReclamables(tx, nivel, entidadId, vigenciaSql, {
  origenLocalId: origen.origenLocalId,
  origenPuntoDeVentaId: origen.origenPuntoDeVentaId,
});

const resultado = await aplicarRegla(tx, {
  reglaId: regla.id,
  nivel,
  entidadId,
  vigencia: vigenciaNueva,
  origen: { origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId },
  destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
});
```

Esto necesita `vigenciaSql` disponible en el handler — hoy `aplicarRegla` calcula `vigenciaSql` internamente (`resolverVigencia`/`vigenciaToSql`), el route handler no lo tiene. Agregar, justo antes de la llamada a `liberarComprasReclamables`:

```ts
import { resolverVigencia, vigenciaToSql } from "@/lib/apertura/vigencia";
import { Prisma } from "@prisma/client";
// ...
const condVigencia = resolverVigencia(vigenciaNueva);
const vigenciaSql = vigenciaToSql(condVigencia, Prisma.sql`COALESCE(c."fechaManual", c.fecha)`);
```

- [ ] **Step 3: Misma llamada en `PATCH /api/apertura/reglas/[id]` (rama editar)**

En `app/api/apertura/reglas/[id]/route.ts`, mismo patrón — agregar antes de la llamada a `aplicarRegla` dentro de la transacción de edición (después de `revertirRegla(tx, id)` + recrear destinos, antes de re-aplicar):

```ts
const condVigencia = resolverVigencia(vigenciaNueva);
const vigenciaSql = vigenciaToSql(condVigencia, Prisma.sql`COALESCE(c."fechaManual", c.fecha)`);
await liberarComprasReclamables(tx, existente.nivel, existente.entidadId, vigenciaSql, {
  origenLocalId: origen.origenLocalId,
  origenPuntoDeVentaId: origen.origenPuntoDeVentaId,
});

const resultado = await aplicarRegla(tx, {
  reglaId: regla.id,
  nivel: existente.nivel,
  entidadId: existente.entidadId,
  vigencia: vigenciaNueva,
  origen: { origenLocalId: origen.origenLocalId, origenPuntoDeVentaId: origen.origenPuntoDeVentaId },
  destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
});
```

Agregar los imports que falten al principio del archivo: `import { Prisma } from "@prisma/client";` (no existía en este archivo — hace falta para `Prisma.sql` en el cálculo de `vigenciaSql`), `resolverVigencia, vigenciaToSql` desde `@/lib/apertura/vigencia`, y `liberarComprasReclamables` sumado a la lista ya importada desde `@/lib/apertura/motor`.

- [ ] **Step 4: Verificar tipos, lint y tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/motor.ts "app/api/apertura/reglas/route.ts" "app/api/apertura/reglas/[id]/route.ts"
git commit -m "feat(apertura): liberarComprasReclamables — reglas de mayor prioridad ceden compras de menor prioridad antes de aplicar

Sin esto, crear una regla de proveedor nunca hubiera podido reclamar
compras que ya tenía tomadas una regla de concepto (aplicarRegla solo
mira compras con esDistribuido = false). No-op para nivel concepto — no
cambia el comportamiento de v1.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `reaplicarReglasActivas` compartida — reimportación por prioridad + cascada al eliminar

**Files:**
- Modify: `lib/apertura/motor.ts` (nueva función)
- Modify: `lib/apertura/reimportacion.ts` (reusar la función nueva)
- Modify: `app/api/apertura/reglas/[id]/route.ts` (DELETE — cascada tras revertir)

**Interfaces:**
- Consumes: `PRIORIDAD_NIVEL`, `aplicarRegla` (ambos ya existen).
- Produces: `reaplicarReglasActivas(prisma: PrismaClient): Promise<{ reglasReaplicadas: number; errores: string[] }>`.

- [ ] **Step 1: Implementar `reaplicarReglasActivas` en `lib/apertura/motor.ts`**

Agregar al final del archivo:

```ts
// Vuelve a aplicar TODAS las reglas activas, en orden de prioridad
// (registro primero, concepto último) — el orden importa porque
// aplicarRegla reclama greedily lo primero que encuentra sin distribuir
// todavía: si una regla de concepto corriera antes que una de proveedor
// sobre la misma compra recién liberada, se la quedaría igual aunque la de
// proveedor tenga más prioridad. Usada por sincronizarTrasImport
// (reimportacion.ts) y por el cascadeo tras eliminar una regla (ver DELETE
// /api/apertura/reglas/[id]).
export async function reaplicarReglasActivas(
  prisma: PrismaClient
): Promise<{ reglasReaplicadas: number; errores: string[] }> {
  const reglasActivas = await prisma.reglaApertura.findMany({
    where: { estado: "activa" },
    include: { destinos: true },
  });

  const ordenadas = [...reglasActivas].sort(
    (a, b) => PRIORIDAD_NIVEL[b.nivel] - PRIORIDAD_NIVEL[a.nivel]
  );

  const errores: string[] = [];
  let reglasReaplicadas = 0;

  for (const regla of ordenadas) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const vigencia: ReglaVigencia = {
            modo: regla.modo as ReglaVigencia["modo"],
            fechaDesde: regla.fechaDesde,
            fechaHasta: regla.fechaHasta,
            extremosInclusivos: regla.extremosInclusivos,
          };
          await aplicarRegla(tx, {
            reglaId: regla.id,
            nivel: regla.nivel,
            entidadId: regla.entidadId,
            vigencia,
            origen: { origenLocalId: regla.origenLocalId, origenPuntoDeVentaId: regla.origenPuntoDeVentaId },
            destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
          });
        },
        { timeout: 15000 }
      );
      reglasReaplicadas++;
    } catch (err) {
      errores.push(`aplicarRegla(regla #${regla.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { reglasReaplicadas, errores };
}
```

Esta función necesita el tipo `PrismaClient` real (no `AperturaDbClient`) porque arma sus propias `$transaction` por regla — agregar `import type { PrismaClient } from "@prisma/client"` si el archivo no lo tiene ya (ya importa `Prisma` y `PrismaClient` en la línea 1 — reusar el mismo import, solo agregar `PrismaClient` a la lista si falta).

- [ ] **Step 2: Reemplazar el loop inline de `sincronizarTrasImport`**

En `lib/apertura/reimportacion.ts`, borrar el bloque completo:

```ts
  const reglasActivas = await prisma.reglaApertura.findMany({
    where: { estado: "activa" },
    include: { destinos: true },
  });

  let reglasReaplicadas = 0;
  for (const regla of reglasActivas) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const vigencia: ReglaVigencia = {
            modo: regla.modo as ReglaVigencia["modo"],
            fechaDesde: regla.fechaDesde,
            fechaHasta: regla.fechaHasta,
            extremosInclusivos: regla.extremosInclusivos,
          };
          await aplicarRegla(tx, {
            reglaId: regla.id,
            entidadId: regla.entidadId,
            vigencia,
            origen: { origenLocalId: regla.origenLocalId, origenPuntoDeVentaId: regla.origenPuntoDeVentaId },
            destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
          });
        },
        { timeout: 15000 }
      );
      reglasReaplicadas++;
    } catch (err) {
      errores.push(`aplicarRegla(regla #${regla.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
```

y reemplazarlo por:

```ts
  const { reglasReaplicadas, errores: erroresReaplicar } = await reaplicarReglasActivas(prisma);
  errores.push(...erroresReaplicar);
```

Tras este reemplazo, `aplicarRegla` y el tipo `ReglaVigencia` dejan de usarse en todo el archivo (su único uso era dentro del bloque que se acaba de borrar) — actualizar los imports del principio del archivo a:

```ts
import { revertirCompras, reaplicarReglasActivas } from "./motor";
```

y borrar la línea `import type { ReglaVigencia } from "./vigencia";` por completo (ya no queda ninguna referencia a `ReglaVigencia` en este archivo).

- [ ] **Step 3: Cascada tras `DELETE /api/apertura/reglas/[id]`**

En `app/api/apertura/reglas/[id]/route.ts`, después de que la transacción de borrado commitea (fuera de ella — reaplicar puede tocar muchas más reglas de las que boorra esta transacción puntual, mismo criterio de timeouts que ya usa `reimportacion.ts`), agregar la cascada:

```ts
try {
  const { comprasRevertidas } = await prisma.$transaction(
    async (tx) => {
      const resultado = await revertirRegla(tx, id);
      await tx.destinoRegla.deleteMany({ where: { reglaId: id } });
      await tx.reglaApertura.delete({ where: { id } });
      return resultado;
    },
    { timeout: 55000 }
  );

  // Cascada: una regla de menor prioridad puede tener que reclamar las
  // compras que se acaban de liberar (ver Task 4 del plan de motor).
  const { errores: erroresCascada } = await reaplicarReglasActivas(prisma);

  return NextResponse.json({ ok: true, comprasRevertidas, erroresCascada });
} catch (err) {
  console.error("[DELETE /api/apertura/reglas/[id]]", err);
  return NextResponse.json({ error: "Error interno al eliminar la regla" }, { status: 500 });
}
```

Agregar `reaplicarReglasActivas` al import de `@/lib/apertura/motor` en este archivo.

- [ ] **Step 4: Verificar tipos, lint y tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/motor.ts lib/apertura/reimportacion.ts "app/api/apertura/reglas/[id]/route.ts"
git commit -m "refactor(apertura): reaplicarReglasActivas compartida, ordenada por prioridad

Reimportación y la cascada de eliminar una regla usan el mismo loop.
El orden por prioridad es nuevo — con un solo nivel (v1) el orden nunca
importó; con 3, aplicar una regla de concepto antes que una de
proveedor sobre la misma compra recién liberada se la quedaría con la
prioridad incorrecta.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Generalizar `reevaluarCompra` a los 3 niveles

**Files:**
- Modify: `lib/apertura/reevaluacion.ts`

**Interfaces:**
- Consumes: `elegirReglaParaCompra` (sin cambios — sigue pura, sigue testeada tal cual está).
- Produces: `reevaluarCompra` mantiene su firma pública (`(prisma, rowId) => Promise<{reevaluada, distribuidaAhora}>`) — nada que la consuma (`app/api/dashboard/compras/[rowId]/route.ts`) necesita cambiar.

- [ ] **Step 1: Agregar `proveedorId` al `select` de la compra**

En `reevaluarCompra`, el `prisma.compra.findUnique` de hoy selecciona `localId, puntoDeVentaId, fecha, fechaManual, importe, importeManual, conceptoCodigo, conceptoCodigoManual` — agregar `proveedorId: true`:

```ts
const compra = await prisma.compra.findUnique({
  where: { rowId },
  select: {
    localId: true, puntoDeVentaId: true,
    fecha: true, fechaManual: true,
    importe: true, importeManual: true,
    conceptoCodigo: true, conceptoCodigoManual: true,
    proveedorId: true,
  },
});
```

- [ ] **Step 2: Reemplazar la búsqueda de candidatas por un loop de 3 niveles en orden de prioridad**

Reemplazar todo el cuerpo de `reevaluarCompra` desde `const conceptoEfectivo = ...` hasta el final:

```ts
  const conceptoEfectivo = compra.conceptoCodigoManual ?? compra.conceptoCodigo;
  const fechaEfectiva = compra.fechaManual ?? compra.fecha;
  const importeEfectivo = compra.importeManual ?? compra.importe;
  if (!fechaEfectiva || importeEfectivo == null) {
    return { reevaluada: true, distribuidaAhora: false };
  }

  // Orden de prioridad fijo: registro > proveedor > concepto (spec v2). Una
  // compra sin concepto efectivo (dato ausente) simplemente no tiene
  // candidatas de ese nivel — no es motivo para cortar antes, a diferencia de
  // v1 donde concepto era el único nivel posible.
  const nivelesAProbar: { nivel: string; entidadId: string | null }[] = [
    { nivel: "registro", entidadId: rowId },
    { nivel: "proveedor", entidadId: compra.proveedorId != null ? String(compra.proveedorId) : null },
    { nivel: "concepto", entidadId: conceptoEfectivo ?? null },
  ];

  let regla: ReglaCandidata | null = null;
  for (const { nivel, entidadId } of nivelesAProbar) {
    if (entidadId == null) continue;
    const candidatas = await prisma.reglaApertura.findMany({
      where: { estado: "activa", nivel, entidadId },
      select: {
        id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true,
        origenLocalId: true, origenPuntoDeVentaId: true,
        destinos: { select: { id: true, porcentaje: true } },
      },
    });
    regla = elegirReglaParaCompra(
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
    if (regla) break;
  }
  if (!regla) return { reevaluada: true, distribuidaAhora: false };

  await aplicarReglaACompra(prisma, {
    reglaId: regla.id,
    rowId,
    importeBase: Math.round(Number(importeEfectivo.toString()) * 100) / 100,
    destinos: regla.destinos,
  });
  return { reevaluada: true, distribuidaAhora: true };
```

- [ ] **Step 3: Verificar que los tests existentes de `elegirReglaParaCompra` siguen intactos**

Run: `npx vitest run lib/apertura/reevaluacion.test.ts`
Expected: PASS sin cambios — `elegirReglaParaCompra` no se tocó, solo su caller.

- [ ] **Step 4: Verificar tipos, lint y suite completa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/reevaluacion.ts
git commit -m "feat(apertura): reevaluarCompra busca candidatas en los 3 niveles por prioridad

elegirReglaParaCompra queda intacta (sigue pura, sigue testeada) — el
cambio es en la orquestación: antes solo consultaba nivel concepto, ahora
prueba registro, después proveedor, después concepto, quedándose con la
primera que matchee. Una compra sin concepto efectivo ya no corta antes
de tiempo — puede seguir matcheando por proveedor o registro.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Verificación manual contra datos reales (a cargo del usuario)

**Files:** ninguno — solo verificación, requiere confirmación explícita antes de correr cualquier paso contra la base de producción (CLAUDE.md sección 7).

Este repo no tiene tests de integración contra DB para el motor — las fases anteriores de Apertura de Gastos se verificaron así también. Antes de dar este plan por cerrado, correr manualmente (con el usuario presente, confirmando cada paso que escriba/modifique datos reales):

- [ ] **Paso 1**: Crear una regla `nivel: "proveedor"` (vía `POST /api/apertura/reglas` con `nivel: "proveedor"`, `entidadId: "<id de un proveedor real>"`) sobre un proveedor que ya tenga compras cubiertas por una regla de `concepto` existente. Confirmar que esas compras migran (dejan de estar en las distribuciones de la regla de concepto, pasan a la de proveedor) — invariante: la suma de `distribuciones_apertura.importeCalculado` para cada compra sigue siendo igual a su `importeOriginal`.
- [ ] **Paso 2**: Sobre una de esas compras, crear una regla `nivel: "registro"` (`entidadId: "<rowId de esa compra>"`, `modo: "historico"`). Confirmar que esa compra puntual migra de la regla de proveedor a la de registro, y que las demás compras del proveedor NO se ven afectadas.
- [ ] **Paso 3**: Borrar la regla de registro del Paso 2 (`DELETE /api/apertura/reglas/[id]`). Confirmar que la compra vuelve a quedar cubierta por la regla de proveedor (no por el importe original sin distribuir).
- [ ] **Paso 4**: Editar la compra del Paso 2 vía `PATCH /api/dashboard/compras/[rowId]` cambiando `conceptoCodigoManual` a un concepto distinto que tenga su propia regla de concepto activa. Confirmar que, si el proveedor de esa compra sigue teniendo una regla de proveedor activa, la regla de PROVEEDOR sigue ganando (prioridad correcta) — no la de concepto nueva.
- [ ] **Paso 5**: Correr una reimportación real (o el flujo de ETL que dispare `sincronizarTrasImport`) con al menos una regla de cada nivel activa simultáneamente. Confirmar en los logs/resultado que no hay errores nuevos y que las compras terminan gobernadas por la regla de mayor prioridad que les corresponde.
- [ ] **Paso 6**: Confirmar que los 18 criterios de aceptación de nivel `concepto` (spec v1) siguen comportándose igual — no hace falta re-ejecutarlos uno por uno si el Paso 1-5 no tocó ninguna regla de concepto existente, pero sí revisar que ninguna quedó afectada colateralmente por `liberarComprasReclamables`/`reaplicarReglasActivas`.

---

### Task 7: Verificación final

**Files:** ninguno.

- [ ] **Step 1**: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build` — todo en verde.
- [ ] **Step 2**: Grep de residuos — confirmar que no queda ningún `nivel: "concepto"` hardcodeado fuera de los defaults de schema intencionales:

```bash
grep -rn '"concepto"' lib/apertura/ app/api/apertura/ --include="*.ts" | grep -v ".test.ts"
```

Expected: solo apariciones esperadas — el `default("concepto")` de `nivelReglaSchema` (Task 1) y comentarios explicativos. Cualquier `nivel: "concepto"` hardcodeado en una ruta (fuera de tests) que no sea ese default es un residuo a corregir antes de cerrar.
- [ ] **Step 3**: No hay commit en este task — es puramente de verificación.
