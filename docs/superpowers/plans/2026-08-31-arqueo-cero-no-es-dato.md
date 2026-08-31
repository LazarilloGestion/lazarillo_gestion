# Arqueo en $0 no es un dato de caja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un "Disponible en caja" de exactamente $0 se trate como "sin dato" en todo el sistema — no ancla "Diferencia de caja", no se muestra como "$ 0,00", y se borra al guardar.

**Architecture:** Cuatro cambios de comportamiento (dos funciones puras + dos rutas de API) más un script one-off de limpieza de datos. Sin migración de Prisma: "sin dato" se sigue representando con la ausencia de fila; lo nuevo es que un `monto = 0` se filtra en lectura y borra la fila en escritura.

**Tech Stack:** Next.js 16 route handlers, Prisma 7 (`@prisma/adapter-pg`), Zod, Vitest, `tsx` para scripts.

**Spec:** `docs/superpowers/specs/2026-08-31-arqueo-cero-no-es-dato-design.md`

## Global Constraints

- Regla de negocio: un arqueo válido es una fila de `flujo_caja_manual` con `monto ≠ 0`. Una fila con `monto = 0` y la ausencia de fila son ambas "sin dato", equivalentes e indistinguibles.
- El predicado "sin dato" es `monto === 0` **exacto** — un `monto` negativo (si existiera) sigue siendo un arqueo válido.
- Sin cambios de schema de Prisma ni migraciones (sección 7 del spec).
- La mecánica del acumulado de "Diferencia de caja" (modelo delta del 24-ago) no se toca — solo cambia qué cuenta como "arqueo válido".
- Toda validación de query params / body de API sigue por Zod con `safeParse` (CLAUDE.md §5).
- Errores explícitos, nunca `catch {}` vacío (CLAUDE.md §2).
- Conventional Commits (CLAUDE.md §6).
- Correr `npm run lint` y `npm run build` antes de dar la tarea por cerrada (CLAUDE.md §7).
- El script de limpieza toca datos del cliente: corre en dry-run por defecto, requiere `--apply`, y su ejecución real contra dev/prod la hace el usuario, no el agente (spec 4.7 + CLAUDE.md §7).

---

### Task 1: `computeDiferenciaCajaAcumulada` — tratar `disponible === 0` igual que `null`

**Files:**
- Modify: `lib/dashboard/resultados-calc.ts` (función `computeDiferenciaCajaAcumulada`, ~líneas 38-58)
- Test: `lib/dashboard/resultados-calc.test.ts` (describe `computeDiferenciaCajaAcumulada`, ~línea 61)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `computeDiferenciaCajaAcumulada(serie: MesDatos[], primerArqueo: { anio: number; mes: number } | null): (number | null)[]` — firma sin cambios. Cambia el comportamiento interno: un mes con `disponible === 0` se trata como "sin arqueo propio" (no aporta variación, arrastra la referencia), idéntico a `disponible === null`.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/dashboard/resultados-calc.test.ts`, dentro del `describe("computeDiferenciaCajaAcumulada", ...)`, agregar:

```ts
  it("un disponible en 0 se trata como sin arqueo, no como un arqueo real de cero", () => {
    // jun/jul/ago con disponible 0 (filas fantasma), sep primer arqueo real.
    const serie: MesDatos[] = [
      { anio: 2025, mes: 6, ingresos: 100, egresos: 40, ganancia: 20, disponible: 0 },   // jun
      { anio: 2025, mes: 7, ingresos: 100, egresos: 40, ganancia: 20, disponible: 0 },   // jul
      { anio: 2025, mes: 8, ingresos: 100, egresos: 40, ganancia: 20, disponible: 0 },   // ago
      { anio: 2025, mes: 9, ingresos: 100, egresos: 40, ganancia: 20, disponible: 500 }, // sep — primer arqueo real
      { anio: 2025, mes: 10, ingresos: 120, egresos: 50, ganancia: 30, disponible: null }, // oct
    ];
    const resultado = computeDiferenciaCajaAcumulada(serie, { anio: 2025, mes: 9 });
    expect(resultado[0]).toBeNull(); // jun
    expect(resultado[1]).toBeNull(); // jul
    expect(resultado[2]).toBeNull(); // ago
    expect(resultado[3]).toBeNull(); // sep, mes del primer arqueo
    // oct: primer valor calculado. referencia = disponible[sep] = 500, oct sin arqueo -> delta 0
    // contribución = 0 - ((120-50)-30) = -40
    expect(resultado[4]).toBe(-40);
  });

  it("un disponible en 0 entre dos arqueos válidos no resetea la referencia", () => {
    // sep=500, oct=0 (fila fantasma), nov=600. La variación de nov se mide contra sep (500), no contra 0.
    const serie: MesDatos[] = [
      { anio: 2025, mes: 9, ingresos: 100, egresos: 40, ganancia: 20, disponible: 500 },  // sep — primer arqueo
      { anio: 2025, mes: 10, ingresos: 100, egresos: 40, ganancia: 20, disponible: 0 },   // oct — fila fantasma
      { anio: 2025, mes: 11, ingresos: 110, egresos: 45, ganancia: 25, disponible: 600 }, // nov
    ];
    const resultado = computeDiferenciaCajaAcumulada(serie, { anio: 2025, mes: 9 });
    // oct: disponible 0 -> tratado como sin arqueo, delta 0. contribución = 0 - ((100-40)-20) = -40. acc = -40
    expect(resultado[1]).toBe(-40);
    // nov: disponible 600, delta contra referencia 500 = 100. contribución = 100 - ((110-45)-25) = 60. acc = -40 + 60 = 20
    expect(resultado[2]).toBe(20);
  });
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/dashboard/resultados-calc.test.ts -t "disponible en 0"`
Expected: FAIL — el primer test da `resultado[4]` distinto de `-40` (hoy el 0 de sep... no; hoy jun/jul/ago con 0 hacen que `deltaDisponible` se calcule contra `referencia`, arrastrando basura), el segundo da `resultado[2]` distinto de `20` (hoy la referencia se pisa a 0 en octubre).

- [ ] **Step 3: Implementar el cambio mínimo**

En `lib/dashboard/resultados-calc.ts`, dentro de `computeDiferenciaCajaAcumulada`, reemplazar el cuerpo del `for`:

```ts
  let referencia = serie[i0].disponible ?? 0;
  let acc = 0;
  for (let i = i0 + 1; i < serie.length; i++) {
    const m = serie[i];
    // Un disponible en 0 es "sin arqueo ese mes" (ver spec 2026-08-31), igual que null:
    // no aporta variación y no pisa la referencia del último arqueo conocido.
    const tieneArqueo = m.disponible != null && m.disponible !== 0;
    const deltaDisponible = tieneArqueo ? m.disponible! - referencia : 0;
    if (tieneArqueo) referencia = m.disponible!;
    acc += deltaDisponible - ((m.ingresos - m.egresos) - m.ganancia);
    resultado[i] = acc;
  }
  return resultado;
```

Actualizar el comentario de bloque de la función (arriba de `export function computeDiferenciaCajaAcumulada`) para que diga que `0` y `null` son ambos "sin arqueo ese mes".

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/dashboard/resultados-calc.test.ts`
Expected: PASS — los dos tests nuevos y todos los existentes del archivo (los viejos usan `disponible: null`, no se ven afectados).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/resultados-calc.ts lib/dashboard/resultados-calc.test.ts
git commit -m "fix(dashboard): disponible en \$0 se trata como sin arqueo en el acumulado de caja"
```

---

### Task 2: `aggregateFlujoCajaPorMes` — descartar filas `monto === 0`

**Files:**
- Modify: `lib/dashboard/flujo-caja-agg.ts` (función `aggregateFlujoCajaPorMes`, ~línea 14)
- Test: `lib/dashboard/flujo-caja-agg.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `aggregateFlujoCajaPorMes(rows: FlujoCajaRow[], puntoDeVentaId?: number): Record<number, number | null>` — firma sin cambios. Las filas con `monto === 0` se ignoran antes de agregar; un mes cuyas únicas filas son `monto === 0` queda en `null`, no en `0`.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/dashboard/flujo-caja-agg.test.ts`, agregar (ajustar el `describe` al que ya exista en el archivo):

```ts
  it("una fila con monto 0 no cuenta como dato: el mes queda en null", () => {
    const meses = aggregateFlujoCajaPorMes(
      [{ localId: 2, puntoDeVentaId: null, mes: 6, monto: 0 }],
    );
    expect(meses[6]).toBeNull();
  });

  it("mismo mes con una fila en 0 y otra con valor real: agrega solo la real", () => {
    const meses = aggregateFlujoCajaPorMes(
      [
        { localId: 2, puntoDeVentaId: 10, mes: 9, monto: 0 },
        { localId: 2, puntoDeVentaId: 11, mes: 9, monto: 1000 },
      ],
    );
    expect(meses[9]).toBe(1000);
  });

  it("con puntoDeVentaId puntual, una fila en 0 tampoco cuenta", () => {
    const meses = aggregateFlujoCajaPorMes(
      [{ localId: 2, puntoDeVentaId: 10, mes: 9, monto: 0 }],
      10,
    );
    expect(meses[9]).toBeNull();
  });
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/dashboard/flujo-caja-agg.test.ts -t "monto 0"`
Expected: FAIL — hoy `meses[6]` da `0` (la fila entra a la suma), no `null`.

- [ ] **Step 3: Implementar el cambio mínimo**

En `lib/dashboard/flujo-caja-agg.ts`, primera línea del cuerpo de `aggregateFlujoCajaPorMes`:

```ts
export function aggregateFlujoCajaPorMes(
  rows: FlujoCajaRow[],
  puntoDeVentaId?: number,
): Record<number, number | null> {
  // Un monto en 0 es "sin dato", no un arqueo (ver spec 2026-08-31). Se descarta acá para que
  // un mes cuyas únicas filas son 0 quede en null y la celda muestre "—", no "$ 0,00".
  rows = rows.filter((r) => r.monto !== 0);

  const meses: Record<number, number | null> = {};
  for (let m = 1; m <= 12; m++) meses[m] = null;
  // ...resto sin cambios
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/dashboard/flujo-caja-agg.test.ts`
Expected: PASS — los tres tests nuevos y todos los existentes.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/flujo-caja-agg.ts lib/dashboard/flujo-caja-agg.test.ts
git commit -m "fix(dashboard): filas de flujo de caja en \$0 no cuentan como dato en la agregación"
```

---

### Task 3: Rutas de lectura — filtrar `monto ≠ 0` + copy del popover

**Files:**
- Modify: `app/api/dashboard/flujo-caja/primer-arqueo/route.ts` (`findFirst`, ~línea 30)
- Modify: `app/api/dashboard/flujo-caja/route.ts` (GET, `findMany`, ~línea 35)
- Modify: `components/dashboard/caja-rows.tsx` (`PopoverContent` de "Diferencia de caja", línea de "Sin dato", ~línea 168)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `GET /api/dashboard/flujo-caja/primer-arqueo` ignora filas `monto = 0` al ubicar el primer arqueo. `GET /api/dashboard/flujo-caja` devuelve `null` (no `0`) para meses cuyas filas son todas `monto = 0`. Sin cambios de shape en las responses.

- [ ] **Step 1: `primer-arqueo` — agregar el filtro `monto`**

En `app/api/dashboard/flujo-caja/primer-arqueo/route.ts`, en el `where` del `findFirst`:

```ts
    const primera = await prisma.flujoCajaManual.findFirst({
      where: {
        monto: { not: 0 },
        ...(localId !== undefined ? { localId } : {}),
        ...(puntoDeVentaId !== undefined ? { puntoDeVentaId } : {}),
      },
      orderBy: [{ anio: "asc" }, { mes: "asc" }],
      select: { anio: true, mes: true },
    });
```

Agregar un comentario de una línea sobre el `monto: { not: 0 }` ("un $0 es 'sin dato', no ancla el cálculo — ver spec 2026-08-31").

- [ ] **Step 2: GET `flujo-caja` — agregar el filtro `monto`**

En `app/api/dashboard/flujo-caja/route.ts`, en el `where` del `findMany` del handler `GET`:

```ts
    const rows = await prisma.flujoCajaManual.findMany({
      where: {
        anio,
        monto: { not: 0 },
        ...(localId !== undefined ? { localId } : {}),
        ...(puntoDeVentaId !== undefined ? { puntoDeVentaId } : {}),
      },
      select: { localId: true, puntoDeVentaId: true, mes: true, monto: true },
    });
```

Comentario de una línea sobre el `monto: { not: 0 }`, mismo criterio.

- [ ] **Step 3: Copy del popover**

En `components/dashboard/caja-rows.tsx`, dentro del `PopoverContent` de "Diferencia de caja", en el `<span>` que hoy dice `Sin dato: mes anterior o igual al primer arqueo, o directamente sin ningún arqueo cargado.`, cambiarlo a:

```tsx
                  <span><span className="font-medium text-foreground/80">Sin dato:</span> mes anterior o igual al primer arqueo, un mes con arqueo en $0, o directamente sin ningún arqueo cargado.</span>
```

- [ ] **Step 4: Verificación de tipos y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 5: Verificación manual con el server de dev**

Run: `npm run dev`, abrir el Dashboard de Resultados, seleccionar San Justo / 2025.
Expected (todavía NO del todo correcto hasta correr el script de Task 5 — las filas $0 siguen en la DB, pero ahora el endpoint las filtra): jun/jul/ago muestran "—" en "Disponible en caja"; "Diferencia de caja" arranca en octubre. Anotar si algo no cuadra.

- [ ] **Step 6: Commit**

```bash
git add app/api/dashboard/flujo-caja/primer-arqueo/route.ts app/api/dashboard/flujo-caja/route.ts components/dashboard/caja-rows.tsx
git commit -m "fix(dashboard): rutas de flujo de caja ignoran arqueos en \$0"
```

---

### Task 4: PUT `flujo-caja` — borrar la fila cuando `monto === 0`

**Files:**
- Modify: `app/api/dashboard/flujo-caja/route.ts` (handler `PUT`, ~líneas 62-92)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `PUT /api/dashboard/flujo-caja` con body `{ ..., monto: 0 }` borra la fila `(localId, puntoDeVentaId, anio, mes)` si existe, y responde `{ ok: true }`. Con `monto ≠ 0` sigue haciendo el upsert de siempre.

- [ ] **Step 1: Agregar el branch de borrado**

En `app/api/dashboard/flujo-caja/route.ts`, dentro del `try` del handler `PUT`, antes del `$executeRaw` del `INSERT`:

```ts
  try {
    // Un monto en 0 significa "sin dato" (ver spec 2026-08-31): se borra la fila en vez de
    // guardar un $0 que después no se puede limpiar. Borrar una fila inexistente es no-op.
    // IS NOT DISTINCT FROM para matchear con localId/puntoDeVentaId en null, consistente con el
    // índice único NULLS NOT DISTINCT (migración 20260723000100).
    if (monto === 0) {
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM "flujo_caja_manual"
        WHERE "localId" IS NOT DISTINCT FROM ${localId ?? null}
          AND "puntoDeVentaId" IS NOT DISTINCT FROM ${puntoDeVentaId ?? null}
          AND "anio" = ${anio}
          AND "mes" = ${mes}
      `);
      return NextResponse.json({ ok: true });
    }

    // Prisma no permite null en el lookup de una unique key compuesta... (comentario existente)
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "flujo_caja_manual" ...
    `);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[PUT /api/dashboard/flujo-caja]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
```

- [ ] **Step 2: Verificación de tipos y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 3: Verificación manual con el server de dev**

Run: `npm run dev`, en el Dashboard: seleccionar un local, editar "Disponible en caja" de un mes cualquiera con un valor real (ej. `1000`) y guardar → aparece `$ 1.000,00`. Volver a editar ese mes, borrar el contenido del input (dejarlo vacío) y guardar → la celda vuelve a "—". Recargar la página → sigue en "—".
Expected: el ciclo cargar → limpiar → recargar deja la celda en "—", sin fila fantasma.

- [ ] **Step 4: Commit**

```bash
git add app/api/dashboard/flujo-caja/route.ts
git commit -m "fix(dashboard): guardar Disponible en caja vacío borra la fila en vez de guardar \$0"
```

---

### Task 5: Script one-off de limpieza de filas `monto = 0`

**Files:**
- Create: `scripts/limpiar-flujo-caja-cero.ts`
- Test: `scripts/limpiar-flujo-caja-cero.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `resumirFilasCero(rows: FilaCero[]): string` — helper puro que arma el reporte legible del plan de borrado. El script en sí: dry-run por defecto (reporta, no escribe), `--apply` ejecuta el `DELETE FROM "flujo_caja_manual" WHERE "monto" = 0`.

- [ ] **Step 1: Escribir el test del helper de reporte**

Crear `scripts/limpiar-flujo-caja-cero.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resumirFilasCero, type FilaCero } from "./limpiar-flujo-caja-cero";

describe("resumirFilasCero", () => {
  it("sin filas: informa que no hay nada que borrar", () => {
    expect(resumirFilasCero([])).toContain("0 filas");
  });

  it("lista cada fila con local, pdv, año y mes", () => {
    const filas: FilaCero[] = [
      { localId: 2, puntoDeVentaId: null, anio: 2025, mes: 6 },
      { localId: 2, puntoDeVentaId: null, anio: 2025, mes: 7 },
      { localId: 3, puntoDeVentaId: 10, anio: 2025, mes: 8 },
    ];
    const salida = resumirFilasCero(filas);
    expect(salida).toContain("3 filas");
    expect(salida).toContain("local 2");
    expect(salida).toContain("2025-06");
    expect(salida).toContain("pdv 10");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run scripts/limpiar-flujo-caja-cero.test.ts`
Expected: FAIL — el módulo todavía no existe.

- [ ] **Step 3: Escribir el script**

Crear `scripts/limpiar-flujo-caja-cero.ts` (seguir el patrón de `scripts/cleanup-duplicados-compras.ts`):

```ts
/**
 * limpiar-flujo-caja-cero.ts
 *
 * Borra las filas de flujo_caja_manual con monto = 0. Un arqueo en $0 es "sin dato"
 * (ver docs/superpowers/specs/2026-08-31-arqueo-cero-no-es-dato-design.md): no debería
 * existir como fila. Estas filas quedaron de un camino de escritura viejo que persistía
 * $0 al guardar una celda vacía.
 *
 * Dry-run por defecto (solo reporta). Requiere --apply para borrar contra la base real.
 *
 * Uso:
 *   npx tsx scripts/limpiar-flujo-caja-cero.ts            # dry-run
 *   npx tsx scripts/limpiar-flujo-caja-cero.ts --apply     # aplica el borrado
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export interface FilaCero {
  localId: number | null;
  puntoDeVentaId: number | null;
  anio: number;
  mes: number;
}

export function resumirFilasCero(rows: FilaCero[]): string {
  if (rows.length === 0) return "0 filas con monto = 0 — nada que borrar.";
  const lineas = rows
    .map((r) => {
      const local = r.localId != null ? `local ${r.localId}` : "local —";
      const pdv = r.puntoDeVentaId != null ? `pdv ${r.puntoDeVentaId}` : "pdv —";
      const periodo = `${r.anio}-${String(r.mes).padStart(2, "0")}`;
      return `  ${local}, ${pdv}, ${periodo}`;
    })
    .join("\n");
  return `${rows.length} filas con monto = 0:\n${lineas}`;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await prisma.$queryRaw<FilaCero[]>(Prisma.sql`
    SELECT "localId", "puntoDeVentaId", "anio", "mes"
    FROM "flujo_caja_manual"
    WHERE "monto" = 0
    ORDER BY "localId", "puntoDeVentaId", "anio", "mes"
  `);

  console.log(resumirFilasCero(rows));

  if (!apply) {
    console.log("\nDry-run. Volvé a correr con --apply para borrar.");
    return;
  }

  if (rows.length === 0) return;

  const borradas = await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "flujo_caja_manual" WHERE "monto" = 0
  `);
  console.log(`\nBorradas ${borradas} filas.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run scripts/limpiar-flujo-caja-cero.test.ts`
Expected: PASS.

- [ ] **Step 5: Correr el script en dry-run contra dev**

Run: `npx tsx scripts/limpiar-flujo-caja-cero.ts`
Expected: imprime el listado de filas `monto = 0` (debería incluir San Justo jun/jul/ago 2025) y "Dry-run. Volvé a correr con --apply para borrar." NO escribe nada.

- [ ] **Step 6: Commit**

```bash
git add scripts/limpiar-flujo-caja-cero.ts scripts/limpiar-flujo-caja-cero.test.ts
git commit -m "chore(scripts): script one-off para limpiar filas de flujo de caja en \$0"
```

---

### Task 6: Verificación integral + ejecución de la limpieza + memoria

**Files:**
- Modify: `/Users/imanolalvarez/.claude/projects/-Users-imanolalvarez-Documents-lazarillo-gestion/memory/project_fix_diferencia_caja_spec.md`
- Modify: `/Users/imanolalvarez/.claude/projects/-Users-imanolalvarez-Documents-lazarillo-gestion/memory/MEMORY.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código. Cierre verificado + memoria consistente.

- [ ] **Step 1: Suite completa de tests**

Run: `npm run test`
Expected: PASS, sin regresiones.

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: sin errores. (El build corre `prisma generate` antes — no debería haber drift de schema porque no lo tocamos.)

- [ ] **Step 3: PARAR — pedir al usuario que corra la limpieza**

El agente NO ejecuta el `--apply`. Presentar al usuario:
- La salida del dry-run de Task 5 Step 5 (qué filas se van a borrar).
- El comando exacto: `npx tsx scripts/limpiar-flujo-caja-cero.ts --apply` en dev primero, después contra prod (con el `.env.local` apuntando a cada uno).
- Esperar confirmación explícita antes de seguir. Es dato del cliente (CLAUDE.md §7).

- [ ] **Step 4: Verificación visual post-limpieza (con el usuario)**

Con las filas ya borradas en dev: Dashboard → San Justo → 2025.
Expected (criterios de aceptación del spec, sección 6):
- CA-01: jun/jul/ago muestran "—" en "Disponible en caja".
- CA-02: "Diferencia de caja" arranca en octubre (primera celda con número).
- CA-03: cargar un valor real en un mes y después limpiarlo deja la celda en "—".
- CA-04: septiembre (arqueo real) sigue anclando; los valores de oct/nov en adelante son coherentes con lo que Diego espera.

- [ ] **Step 5: Actualizar la memoria**

En `project_fix_diferencia_caja_spec.md`, agregar una nota al final de la sección de estado:

```markdown
## Actualización 31-ago-2026 — "$0 nunca es arqueo válido" (revierte la decisión de "$0 sí cuenta")
Diego reportó que jun/jul/ago 2025 de San Justo mostraban $0 en Disponible en caja sin haberlo
cargado, y que Diferencia de caja arrancaba en julio en vez de octubre. Se revirtió la decisión
de esta sesión ("un $0 real cargado por el usuario SÍ cuenta"): ahora `monto != 0` es la
condición de arqueo válido. `primer-arqueo` y el GET de flujo-caja filtran `monto != 0`, el PUT
con monto 0 borra la fila, y `computeDiferenciaCajaAcumulada` trata 0 ≡ null. Script one-off
`scripts/limpiar-flujo-caja-cero.ts` borró las filas fantasma. Spec:
`docs/superpowers/specs/2026-08-31-arqueo-cero-no-es-dato-design.md`.
```

En `MEMORY.md`, agregar la línea al índice:

```markdown
- [Fix arqueo $0 no es dato (31-ago-2026)](project_fix_diferencia_caja_spec.md) — revierte "$0 cuenta como arqueo": ahora monto != 0 es la condición; ver también actualización en ese archivo
```

(Si preferís un archivo de memoria separado en vez de anexar al existente, crealo como `project_fix_arqueo_cero.md` con `[[project_fix_diferencia_caja_spec]]` enlazado — decisión del que ejecute, coordinando con el usuario.)

- [ ] **Step 6: Commit de la memoria + cierre de rama**

```bash
git add -A && git commit -m "docs(memory): registra la reversión de criterio sobre arqueos en \$0"
```

Después: `superpowers:finishing-a-development-branch` para decidir el merge/PR (conventional commits, rama `dev`).

---

## Self-Review

**Spec coverage:**
- Spec 4.1 (primer-arqueo filtra) → Task 3 Step 1. ✓
- Spec 4.2 (GET flujo-caja filtra) → Task 3 Step 2. ✓
- Spec 4.3 (PUT borra en 0) → Task 4. ✓
- Spec 4.4 (computeDiferenciaCajaAcumulada: 0 ≡ null) → Task 1. ✓
- Spec 4.5 (aggregateFlujoCajaPorMes descarta 0) → Task 2. ✓
- Spec 4.6 (copy popover) → Task 3 Step 3. ✓
- Spec 4.7 (script limpieza) → Task 5 + Task 6 Step 3. ✓
- Spec 5 (testing: casos nuevos en resultados-calc.test.ts y flujo-caja-agg.test.ts) → Task 1 Step 1, Task 2 Step 1. ✓
- Spec 6 (CA-01..CA-06) → Task 6 Step 4 + tests de Task 1/2. ✓
- Spec 7 (sin migración) → Global Constraints, ninguna task toca schema. ✓
- Spec 8 (actualizar memoria) → Task 6 Step 5. ✓

**Placeholder scan:** sin TBD/TODO. Todos los pasos de código tienen el bloque real.

**Type consistency:** `computeDiferenciaCajaAcumulada` y `aggregateFlujoCajaPorMes` mantienen firma. `FilaCero` / `resumirFilasCero` definidos en Task 5 y usados solo ahí. `MesDatos` es el tipo existente de `resultados-calc.ts`, no se redefine.
