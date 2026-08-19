# Apertura de Gastos — Fase B (Motor + Lectura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el motor de reglas de Apertura de Gastos a nivel "concepto de caja" — CRUD de reglas, aplicación/reversión síncrona sobre `compras`, y una vista SQL que hace que `pivot`/`detalle` reflejen las distribuciones sin cambiar de forma. Sin UI (Fase C).

**Architecture:** Capa `lib/apertura/` con módulos puros (partición de importes, resolución de vigencia, validación de suma/superposición, schemas Zod) separados de dos orquestadores impuros (`aplicarRegla`, `revertirRegla`) que ejecutan SQL crudo en lote — mismo patrón que `lib/etl/normalizers/compras.ts` ya usa. Dos route handlers nuevos (`app/api/apertura/reglas/`) exponen el CRUD. Una vista SQL (`v_compras_distribuidas`) centraliza la lectura: `compras` sin distribuir + fan-out de `distribuciones_apertura` para las distribuidas, con las mismas columnas que `compras` para que `buildPivotConditions` no cambie.

**Tech Stack:** Next.js 16 route handlers + Prisma 7 (`$queryRaw`/`$executeRaw` para SQL crudo, `$transaction` para atomicidad) + Zod (`safeParse`) + vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-apertura-gastos-design.md` (secciones 3-10.1, y las correcciones de la sección 4/5/11 agregadas 19-ago-2026 durante este mismo `writing-plans`) + memoria de proyecto `project_apertura_gastos_spec.md` (18 criterios de aceptación CA-01..CA-18).

## Global Constraints

- Nombres de tabla/columna en español, consistentes con el schema existente — ya aplicado en Fase A, este plan no toca schema.prisma salvo la vista (que no se modela ahí, ver Task 1).
- TypeScript estricto, sin `any` sin justificar.
- Toda validación de body de API route pasa por Zod `safeParse` (CLAUDE.md sección 5/8).
- `requireAuth()` en todo route handler nuevo, sin excepciones.
- El motor lee siempre el valor **efectivo** de una compra, no el crudo del ERP: `COALESCE(importeManual, importe)` como base del prorrateo, `COALESCE(conceptoCodigoManual, conceptoCodigo)` para matchear concepto, `COALESCE(fechaManual, fecha)` para la ventana de vigencia (decisión de negocio confirmada 19-ago-2026, sección 5 del diseño).
- `distribuciones_apertura.importeOriginal` guarda ese valor efectivo, no el importe crudo del ERP.
- Sin librerías nuevas — todo con lo que ya está en el stack (CLAUDE.md sección 8).
- Sin base de datos de test/dev: los módulos puros (`calculo.ts`, `vigencia.ts`, `validaciones.ts`, `schemas.ts`) llevan TDD completo con vitest; los orquestadores DB-touching (`motor.ts`) no tienen test automatizado — gap documentado en la sección 11 del diseño, compensado con la verificación manual gateada de la Task 9.
- Ninguna operación de este plan toca compras/ventas ya importadas hasta la Task 9 — todas las tasks anteriores son código nuevo revisado en un worktree, sin aplicar contra producción.
- Fuente de datos: solo `compras` (tabla 14) — `ventas`/`pivot-ventas` no se tocan, fuera de alcance (ver diseño sección 1).

---

### Task 1: Migración SQL — vista `v_compras_distribuidas`

**Files:**
- Create: `prisma/migrations/20260819163000_v_compras_distribuidas/migration.sql`

**Interfaces:**
- Produces: la vista `v_compras_distribuidas`, con las mismas columnas (mismo nombre, mismo tipo) que `compras`: `"rowId"`, `"localId"`, `"puntoDeVentaId"`, `importe`, `"importeManual"`, `fecha`, `"fechaManual"`, `"conceptoCodigo"`, `"conceptoCodigoManual"`, `concepto`, `detalle`, `observac`, `"observacManual"`, `proveedor`, `"proveedorId"`, más `"distribucionId"` (nullable, `NULL` en la rama no distribuida). Task 8 la consume vía `$queryRaw` — ningún cambio en `schema.prisma` (la vista no se modela como cliente tipado de Prisma, se accede solo con SQL crudo).

No hay `schema.prisma` que diffear para esta migración (una vista SQL pura no es representable como modelo Prisma sin el preview feature `views`, que este proyecto no usa — no se agrega, sería un cambio de stack sin preguntar). El archivo se escribe a mano, seguido el mismo patrón manual que otras migraciones puramente SQL de este repo.

- [ ] **Step 1: Crear el directorio y archivo de migración**

```bash
mkdir -p prisma/migrations/20260819163000_v_compras_distribuidas
```

- [ ] **Step 2: Escribir el SQL de la vista**

Contenido completo de `prisma/migrations/20260819163000_v_compras_distribuidas/migration.sql`:

```sql
-- Vista centralizada de lectura para Apertura de Gastos (Fase B). Compras sin
-- distribuir se ven igual que hoy; compras distribuidas aparecen como N filas
-- (una por destino de la regla que las cubre), con local/puntoDeVenta e
-- importe del destino en vez de la compra original. Mismas columnas que
-- "compras" para que buildPivotConditions (lib/dashboard/query-builders.ts)
-- no cambie de forma — ver docs/superpowers/specs/2026-08-19-apertura-gastos-design.md
-- sección 4.
CREATE VIEW v_compras_distribuidas AS
SELECT
  c."rowId",
  NULL::integer            AS "distribucionId",
  c."localId",
  c."puntoDeVentaId",
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
  c."proveedorId"
FROM compras c
WHERE c."esDistribuido" = false

UNION ALL

SELECT
  c."rowId",
  d.id                      AS "distribucionId",
  dr."localId",
  dr."puntoDeVentaId",
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
  c."proveedorId"
FROM distribuciones_apertura d
JOIN compras c        ON c."rowId" = d."compraRowId"
JOIN destinos_regla dr ON dr.id    = d."destinoId";
```

- [ ] **Step 3: Verificar sintaxis manualmente (sin DB disponible)**

No hay base de test/dev para aplicar esto localmente (ver Global Constraints). Releer el SQL contra el schema real (`prisma/schema.prisma`, tablas `compras`, `distribuciones_apertura`, `destinos_regla`): confirmar que cada columna referenciada existe con ese nombre exacto y que los tipos de las dos ramas del `UNION ALL` coinciden posición a posición (Postgres exige tipos compatibles por columna en un `UNION ALL`, no por nombre). La aplicación real y la verificación funcional quedan en la Task 9.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/20260819163000_v_compras_distribuidas
git commit -m "feat(apertura-gastos): agrega migración de la vista v_compras_distribuidas"
```

---

### Task 2: `lib/apertura/calculo.ts` — partición de importes

**Files:**
- Create: `lib/apertura/calculo.ts`
- Test: `lib/apertura/calculo.test.ts`

**Interfaces:**
- Produces: `DestinoPct { id: number; porcentaje: number }`, `DistribucionCalculada { destinoId: number; importeCalculado: number }`, `calcularDistribuciones(importeBase: number, destinos: DestinoPct[]): DistribucionCalculada[]`.
- Consumes: nada (módulo puro, sin dependencias del proyecto).

- [ ] **Step 1: Escribir los tests (deben fallar — el módulo no existe todavía)**

Contenido completo de `lib/apertura/calculo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { calcularDistribuciones } from "./calculo";

describe("calcularDistribuciones", () => {
  it("divide 50/50 sin resto ($1.000.000 -> $500.000/$500.000, fixture CA-01 de la spec)", () => {
    const result = calcularDistribuciones(1000000, [
      { id: 1, porcentaje: 50 },
      { id: 2, porcentaje: 50 },
    ]);
    expect(result).toEqual([
      { destinoId: 1, importeCalculado: 500000 },
      { destinoId: 2, importeCalculado: 500000 },
    ]);
  });

  it("recalcula sobre el nuevo importe al reimportar ($1.200.000 -> $600.000/$600.000, fixture CA-02)", () => {
    const result = calcularDistribuciones(1200000, [
      { id: 1, porcentaje: 50 },
      { id: 2, porcentaje: 50 },
    ]);
    expect(result).toEqual([
      { destinoId: 1, importeCalculado: 600000 },
      { destinoId: 2, importeCalculado: 600000 },
    ]);
  });

  it("reparto no exacto (33/33/34): el último destino se lleva el resto, la suma da exacto", () => {
    const result = calcularDistribuciones(100, [
      { id: 1, porcentaje: 33 },
      { id: 2, porcentaje: 33 },
      { id: 3, porcentaje: 34 },
    ]);
    expect(result).toEqual([
      { destinoId: 1, importeCalculado: 33 },
      { destinoId: 2, importeCalculado: 33 },
      { destinoId: 3, importeCalculado: 34 },
    ]);
  });

  it("importe con centavos no exactamente divisible: la suma da el total exacto (invariante no negociable)", () => {
    const result = calcularDistribuciones(100.01, [
      { id: 1, porcentaje: 33.33 },
      { id: 2, porcentaje: 33.33 },
      { id: 3, porcentaje: 33.34 },
    ]);
    const suma = result.reduce((acc, d) => acc + d.importeCalculado, 0);
    expect(Math.round(suma * 100) / 100).toBe(100.01);
  });

  it("es determinístico: ordena por id de destino sin importar el orden de entrada", () => {
    const a = calcularDistribuciones(1000, [
      { id: 2, porcentaje: 40 },
      { id: 1, porcentaje: 60 },
    ]);
    const b = calcularDistribuciones(1000, [
      { id: 1, porcentaje: 60 },
      { id: 2, porcentaje: 40 },
    ]);
    expect(a).toEqual(b);
  });

  it("un solo destino al 100%: recibe el importe completo sin redondeo", () => {
    const result = calcularDistribuciones(750, [{ id: 1, porcentaje: 100 }]);
    expect(result).toEqual([{ destinoId: 1, importeCalculado: 750 }]);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run lib/apertura/calculo.test.ts`
Expected: FAIL — `Cannot find module './calculo'`

- [ ] **Step 3: Implementar `lib/apertura/calculo.ts`**

```ts
export interface DestinoPct {
  id: number;
  porcentaje: number;
}

export interface DistribucionCalculada {
  destinoId: number;
  importeCalculado: number;
}

// Reparto "el último se lleva el resto": evita que el redondeo a centavos
// pierda o sobre-asigne unos pocos centavos — invariante no negociable de la
// spec funcional (sección "Principios no negociables": suma de distribuciones
// = importe original, exacto). Los destinos se ordenan por id para que el
// resultado sea determinístico y reproducible entre corridas.
export function calcularDistribuciones(importeBase: number, destinos: DestinoPct[]): DistribucionCalculada[] {
  const ordenados = [...destinos].sort((a, b) => a.id - b.id);
  const resultado: DistribucionCalculada[] = [];
  let acumulado = 0;

  ordenados.forEach((d, i) => {
    const esUltimo = i === ordenados.length - 1;
    const importeCalculado = esUltimo
      ? Math.round((importeBase - acumulado) * 100) / 100
      : Math.round(((importeBase * d.porcentaje) / 100) * 100) / 100;
    acumulado += importeCalculado;
    resultado.push({ destinoId: d.id, importeCalculado });
  });

  return resultado;
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run lib/apertura/calculo.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/calculo.ts lib/apertura/calculo.test.ts
git commit -m "feat(apertura-gastos): agrega partición de importes con redondeo exacto"
```

---

### Task 3: `lib/apertura/vigencia.ts` — resolución de vigencia temporal

**Files:**
- Create: `lib/apertura/vigencia.ts`
- Test: `lib/apertura/vigencia.test.ts`

**Interfaces:**
- Produces: `ReglaVigencia { modo: "historico" | "entre_fechas" | "desde_adelante" | "desde_atras"; fechaDesde: Date | null; fechaHasta: Date | null; extremosInclusivos: boolean }`, `VigenciaCondicion` (unión discriminada por `tipo`), `resolverVigencia(regla: ReglaVigencia): VigenciaCondicion` (puro, testeado), `vigenciaToSql(cond: VigenciaCondicion, fechaCol: Prisma.Sql): Prisma.Sql` (glue a Prisma, sin test — ver Global Constraints).
- Consumes: `Prisma` de `@prisma/client` (solo en `vigenciaToSql`).

- [ ] **Step 1: Escribir los tests de `resolverVigencia` (deben fallar)**

Contenido completo de `lib/apertura/vigencia.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolverVigencia, type ReglaVigencia } from "./vigencia";

describe("resolverVigencia", () => {
  it("historico: no requiere fechas, siempre matchea", () => {
    const regla: ReglaVigencia = { modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
    expect(resolverVigencia(regla)).toEqual({ tipo: "historico" });
  });

  it("entre_fechas: propaga desde/hasta/inclusivo", () => {
    const desde = new Date("2026-01-01");
    const hasta = new Date("2026-01-31");
    const regla: ReglaVigencia = { modo: "entre_fechas", fechaDesde: desde, fechaHasta: hasta, extremosInclusivos: false };
    expect(resolverVigencia(regla)).toEqual({ tipo: "entre_fechas", desde, hasta, inclusivo: false });
  });

  it("entre_fechas sin fechaDesde: lanza error explícito (nunca silencioso)", () => {
    const regla: ReglaVigencia = {
      modo: "entre_fechas",
      fechaDesde: null,
      fechaHasta: new Date("2026-01-31"),
      extremosInclusivos: true,
    };
    expect(() => resolverVigencia(regla)).toThrow(/fechaDesde/);
  });

  it("entre_fechas sin fechaHasta: lanza error explícito", () => {
    const regla: ReglaVigencia = {
      modo: "entre_fechas",
      fechaDesde: new Date("2026-01-01"),
      fechaHasta: null,
      extremosInclusivos: true,
    };
    expect(() => resolverVigencia(regla)).toThrow(/fechaHasta/);
  });

  it("desde_adelante: requiere solo fechaDesde", () => {
    const desde = new Date("2026-06-01");
    const regla: ReglaVigencia = { modo: "desde_adelante", fechaDesde: desde, fechaHasta: null, extremosInclusivos: true };
    expect(resolverVigencia(regla)).toEqual({ tipo: "desde_adelante", desde, inclusivo: true });
  });

  it("desde_adelante sin fechaDesde: lanza error", () => {
    const regla: ReglaVigencia = { modo: "desde_adelante", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
    expect(() => resolverVigencia(regla)).toThrow(/fechaDesde/);
  });

  it("desde_atras: requiere solo fechaHasta", () => {
    const hasta = new Date("2026-03-01");
    const regla: ReglaVigencia = { modo: "desde_atras", fechaDesde: null, fechaHasta: hasta, extremosInclusivos: false };
    expect(resolverVigencia(regla)).toEqual({ tipo: "desde_atras", hasta, inclusivo: false });
  });

  it("desde_atras sin fechaHasta: lanza error", () => {
    const regla: ReglaVigencia = { modo: "desde_atras", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
    expect(() => resolverVigencia(regla)).toThrow(/fechaHasta/);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run lib/apertura/vigencia.test.ts`
Expected: FAIL — `Cannot find module './vigencia'`

- [ ] **Step 3: Implementar `lib/apertura/vigencia.ts`**

```ts
import { Prisma } from "@prisma/client";

export interface ReglaVigencia {
  modo: "historico" | "entre_fechas" | "desde_adelante" | "desde_atras";
  fechaDesde: Date | null;
  fechaHasta: Date | null;
  extremosInclusivos: boolean;
}

export type VigenciaCondicion =
  | { tipo: "historico" }
  | { tipo: "entre_fechas"; desde: Date; hasta: Date; inclusivo: boolean }
  | { tipo: "desde_adelante"; desde: Date; inclusivo: boolean }
  | { tipo: "desde_atras"; hasta: Date; inclusivo: boolean };

// Puro — sin acceso a SQL/DB, así que es 100% testeable. La conversión a SQL
// vive en vigenciaToSql(), abajo, deliberadamente separada.
export function resolverVigencia(regla: ReglaVigencia): VigenciaCondicion {
  switch (regla.modo) {
    case "historico":
      return { tipo: "historico" };
    case "entre_fechas":
      if (!regla.fechaDesde) throw new Error("modo 'entre_fechas' requiere fechaDesde");
      if (!regla.fechaHasta) throw new Error("modo 'entre_fechas' requiere fechaHasta");
      return { tipo: "entre_fechas", desde: regla.fechaDesde, hasta: regla.fechaHasta, inclusivo: regla.extremosInclusivos };
    case "desde_adelante":
      if (!regla.fechaDesde) throw new Error("modo 'desde_adelante' requiere fechaDesde");
      return { tipo: "desde_adelante", desde: regla.fechaDesde, inclusivo: regla.extremosInclusivos };
    case "desde_atras":
      if (!regla.fechaHasta) throw new Error("modo 'desde_atras' requiere fechaHasta");
      return { tipo: "desde_atras", hasta: regla.fechaHasta, inclusivo: regla.extremosInclusivos };
  }
}

// Glue a Prisma.Sql — no testeado unitariamente (sin DB para verificar que el
// SQL generado es correcto de punta a punta), la lógica de negocio ya está
// cubierta por los tests de resolverVigencia(). fechaCol es la expresión SQL
// de la fecha EFECTIVA (COALESCE ya resuelto por el caller, ver motor.ts).
export function vigenciaToSql(cond: VigenciaCondicion, fechaCol: Prisma.Sql): Prisma.Sql {
  switch (cond.tipo) {
    case "historico":
      return Prisma.sql`TRUE`;
    case "entre_fechas":
      return cond.inclusivo
        ? Prisma.sql`${fechaCol} >= ${cond.desde} AND ${fechaCol} <= ${cond.hasta}`
        : Prisma.sql`${fechaCol} > ${cond.desde} AND ${fechaCol} < ${cond.hasta}`;
    case "desde_adelante":
      return cond.inclusivo ? Prisma.sql`${fechaCol} >= ${cond.desde}` : Prisma.sql`${fechaCol} > ${cond.desde}`;
    case "desde_atras":
      return cond.inclusivo ? Prisma.sql`${fechaCol} <= ${cond.hasta}` : Prisma.sql`${fechaCol} < ${cond.hasta}`;
  }
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run lib/apertura/vigencia.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/vigencia.ts lib/apertura/vigencia.test.ts
git commit -m "feat(apertura-gastos): agrega resolución de vigencia temporal de reglas"
```

---

### Task 4: `lib/apertura/validaciones.ts` — suma de porcentajes y superposición

**Files:**
- Create: `lib/apertura/validaciones.ts`
- Test: `lib/apertura/validaciones.test.ts`

**Interfaces:**
- Consumes: `ReglaVigencia` de `./vigencia` (Task 3).
- Produces: `validarSumaPorcentajes(destinos: { porcentaje: number }[]): boolean`, `encontrarSuperposicion(nueva: ReglaVigencia, existentes: (ReglaVigencia & { id: number })[]): number | null`.

- [ ] **Step 1: Escribir los tests (deben fallar)**

Contenido completo de `lib/apertura/validaciones.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validarSumaPorcentajes, encontrarSuperposicion } from "./validaciones";
import type { ReglaVigencia } from "./vigencia";

describe("validarSumaPorcentajes", () => {
  it("acepta 100 exacto", () => {
    expect(validarSumaPorcentajes([{ porcentaje: 60 }, { porcentaje: 40 }])).toBe(true);
  });

  it("acepta reparto de 3 con redondeo binario menor a 0.01 (33.33/33.33/33.34)", () => {
    expect(
      validarSumaPorcentajes([{ porcentaje: 33.33 }, { porcentaje: 33.33 }, { porcentaje: 33.34 }])
    ).toBe(true);
  });

  it("rechaza suma != 100 (CA-10 de la spec)", () => {
    expect(validarSumaPorcentajes([{ porcentaje: 60 }, { porcentaje: 30 }])).toBe(false);
  });

  it("rechaza lista vacía", () => {
    expect(validarSumaPorcentajes([])).toBe(false);
  });
});

describe("encontrarSuperposicion", () => {
  it("detecta superposición entre dos rangos que se cruzan (CA-08: bloqueo de superposición)", () => {
    const nueva: ReglaVigencia = {
      modo: "entre_fechas",
      extremosInclusivos: true,
      fechaDesde: new Date("2026-01-10"),
      fechaHasta: new Date("2026-02-10"),
    };
    const existentes = [
      { id: 5, modo: "entre_fechas" as const, extremosInclusivos: true, fechaDesde: new Date("2026-02-01"), fechaHasta: new Date("2026-03-01") },
    ];
    expect(encontrarSuperposicion(nueva, existentes)).toBe(5);
  });

  it("no detecta superposición entre rangos consecutivos con extremos exclusivos (CA-09: coexistencia de reglas por período)", () => {
    const nueva: ReglaVigencia = {
      modo: "entre_fechas",
      extremosInclusivos: false,
      fechaDesde: new Date("2026-02-01"),
      fechaHasta: new Date("2026-03-01"),
    };
    const existentes = [
      { id: 5, modo: "entre_fechas" as const, extremosInclusivos: false, fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-02-01") },
    ];
    expect(encontrarSuperposicion(nueva, existentes)).toBeNull();
  });

  it("detecta superposición en el límite cuando ambos extremos son inclusivos", () => {
    const nueva: ReglaVigencia = {
      modo: "entre_fechas",
      extremosInclusivos: true,
      fechaDesde: new Date("2026-02-01"),
      fechaHasta: new Date("2026-03-01"),
    };
    const existentes = [
      { id: 5, modo: "entre_fechas" as const, extremosInclusivos: true, fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-02-01") },
    ];
    expect(encontrarSuperposicion(nueva, existentes)).toBe(5);
  });

  it("historico se superpone con cualquier otra regla activa del mismo concepto", () => {
    const nueva: ReglaVigencia = { modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
    const existentes = [
      { id: 7, modo: "desde_adelante" as const, fechaDesde: new Date("2030-01-01"), fechaHasta: null, extremosInclusivos: true },
    ];
    expect(encontrarSuperposicion(nueva, existentes)).toBe(7);
  });

  it("desde_adelante y desde_atras que no se cruzan: sin superposición", () => {
    const nueva: ReglaVigencia = { modo: "desde_adelante", fechaDesde: new Date("2026-06-01"), fechaHasta: null, extremosInclusivos: true };
    const existentes = [
      { id: 3, modo: "desde_atras" as const, fechaDesde: null, fechaHasta: new Date("2026-05-01"), extremosInclusivos: true },
    ];
    expect(encontrarSuperposicion(nueva, existentes)).toBeNull();
  });

  it("sin reglas existentes: no hay superposición", () => {
    const nueva: ReglaVigencia = { modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
    expect(encontrarSuperposicion(nueva, [])).toBeNull();
  });

  it("devuelve el id de la PRIMERA regla en conflicto cuando hay varias", () => {
    const nueva: ReglaVigencia = { modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true };
    const existentes = [
      { id: 1, modo: "entre_fechas" as const, extremosInclusivos: true, fechaDesde: new Date("2026-01-01"), fechaHasta: new Date("2026-01-31") },
      { id: 2, modo: "entre_fechas" as const, extremosInclusivos: true, fechaDesde: new Date("2026-02-01"), fechaHasta: new Date("2026-02-28") },
    ];
    expect(encontrarSuperposicion(nueva, existentes)).toBe(1);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run lib/apertura/validaciones.test.ts`
Expected: FAIL — `Cannot find module './validaciones'`

- [ ] **Step 3: Implementar `lib/apertura/validaciones.ts`**

```ts
import type { ReglaVigencia } from "./vigencia";

// Tolerancia de redondeo — reparto en 3 con decimales periódicos (33.33 x3 =
// 99.99, no 100) es válido en la práctica (spec no exige más de 2 decimales
// por destino). No confundir con la corrección exacta a nivel importe, que
// calcularDistribuciones ya garantiza vía "el último se lleva el resto".
const TOLERANCIA = 0.01;

export function validarSumaPorcentajes(destinos: { porcentaje: number }[]): boolean {
  if (destinos.length === 0) return false;
  const suma = destinos.reduce((acc, d) => acc + d.porcentaje, 0);
  return Math.abs(suma - 100) <= TOLERANCIA;
}

interface Intervalo {
  desde: number; // epoch ms; -Infinity para "sin límite inferior"
  desdeInclusivo: boolean;
  hasta: number; // epoch ms; +Infinity para "sin límite superior"
  hastaInclusivo: boolean;
}

function aIntervalo(r: ReglaVigencia): Intervalo {
  if (r.modo === "historico") {
    return { desde: -Infinity, desdeInclusivo: true, hasta: Infinity, hastaInclusivo: true };
  }
  const desde = r.modo === "desde_atras" ? -Infinity : r.fechaDesde!.getTime();
  const hasta = r.modo === "desde_adelante" ? Infinity : r.fechaHasta!.getTime();
  return {
    desde,
    desdeInclusivo: r.modo === "desde_atras" ? true : r.extremosInclusivos,
    hasta,
    hastaInclusivo: r.modo === "desde_adelante" ? true : r.extremosInclusivos,
  };
}

function seSuperponen(a: Intervalo, b: Intervalo): boolean {
  const aTerminaAntesDeB = a.hasta < b.desde || (a.hasta === b.desde && !(a.hastaInclusivo && b.desdeInclusivo));
  const bTerminaAntesDeA = b.hasta < a.desde || (b.hasta === a.desde && !(b.hastaInclusivo && a.desdeInclusivo));
  return !aTerminaAntesDeB && !bTerminaAntesDeA;
}

// Devuelve el id de la primera regla existente que se superpone con `nueva`,
// o null si no hay conflicto. `existentes` debe venir pre-filtrado por el
// caller (mismo entidadId + estado 'activa' — ver route handler, Task 7).
export function encontrarSuperposicion(
  nueva: ReglaVigencia,
  existentes: (ReglaVigencia & { id: number })[]
): number | null {
  const intNueva = aIntervalo(nueva);
  for (const existente of existentes) {
    if (seSuperponen(intNueva, aIntervalo(existente))) return existente.id;
  }
  return null;
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run lib/apertura/validaciones.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/validaciones.ts lib/apertura/validaciones.test.ts
git commit -m "feat(apertura-gastos): agrega validación de suma de porcentajes y superposición de reglas"
```

---

### Task 5: `lib/apertura/schemas.ts` — Zod para crear/editar regla

**Files:**
- Create: `lib/apertura/schemas.ts`
- Test: `lib/apertura/schemas.test.ts`

**Interfaces:**
- Consumes: `validarSumaPorcentajes` de `./validaciones` (Task 4).
- Produces: `destinoSchema`, `crearReglaSchema` (+ `CrearReglaInput` type), `patchReglaSchema` (+ `PatchReglaInput` type). Task 7 (route handlers) los usa directamente en `safeParse`.

- [ ] **Step 1: Escribir los tests (deben fallar)**

Contenido completo de `lib/apertura/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { crearReglaSchema, patchReglaSchema } from "./schemas";

const destinosOk = [
  { localId: 1, porcentaje: 60 },
  { localId: 2, porcentaje: 40 },
];

describe("crearReglaSchema", () => {
  it("acepta un cuerpo válido en modo entre_fechas", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "entre_fechas",
      fechaDesde: "2026-01-01T00:00:00Z",
      fechaHasta: "2026-01-31T00:00:00Z",
      extremosInclusivos: true,
      destinos: destinosOk,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza suma de porcentajes != 100 (CA-10)", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: [{ localId: 1, porcentaje: 60 }, { localId: 2, porcentaje: 30 }],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza modo historico sin confirmarHistorico (CA-06: advertencia obligatoria en histórico completo)", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      destinos: destinosOk,
    });
    expect(result.success).toBe(false);
  });

  it("acepta modo historico con confirmarHistorico: true", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: destinosOk,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza entre_fechas sin fechaHasta", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "entre_fechas",
      fechaDesde: "2026-01-01T00:00:00Z",
      destinos: destinosOk,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza desde_adelante sin fechaDesde", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "desde_adelante",
      destinos: destinosOk,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un destino sin localId ni puntoDeVentaId", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: [{ porcentaje: 100 }],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza lista de destinos vacía", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: [],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza entidadId vacío", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "",
      modo: "historico",
      confirmarHistorico: true,
      destinos: destinosOk,
    });
    expect(result.success).toBe(false);
  });
});

describe("patchReglaSchema", () => {
  it("acepta accion: desactivar sin más campos", () => {
    const result = patchReglaSchema.safeParse({ accion: "desactivar" });
    expect(result.success).toBe(true);
  });

  it("acepta accion: editar con cuerpo completo válido", () => {
    const result = patchReglaSchema.safeParse({
      accion: "editar",
      modo: "desde_adelante",
      fechaDesde: "2026-03-01T00:00:00Z",
      destinos: destinosOk,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza accion: editar con suma de porcentajes inválida", () => {
    const result = patchReglaSchema.safeParse({
      accion: "editar",
      modo: "desde_adelante",
      fechaDesde: "2026-03-01T00:00:00Z",
      destinos: [{ localId: 1, porcentaje: 50 }],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza una acción desconocida", () => {
    const result = patchReglaSchema.safeParse({ accion: "reactivar" });
    expect(result.success).toBe(false);
  });

  it("rechaza cuerpo sin accion", () => {
    const result = patchReglaSchema.safeParse({ modo: "historico" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run lib/apertura/schemas.test.ts`
Expected: FAIL — `Cannot find module './schemas'`

- [ ] **Step 3: Implementar `lib/apertura/schemas.ts`**

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

const camposVigencia = {
  modo: z.enum(["historico", "entre_fechas", "desde_adelante", "desde_atras"]),
  fechaDesde: z.string().datetime({ offset: true }).nullable().optional(),
  fechaHasta: z.string().datetime({ offset: true }).nullable().optional(),
  extremosInclusivos: z.boolean().default(true),
  destinos: z.array(destinoSchema).min(1),
  confirmarHistorico: z.boolean().optional(),
};

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
// generadas) o editar (reemplaza destinos/vigencia — el route handler,
// Task 7, revierte y reaplica completo). No hay "reactivar": la spec no
// discute ese caso, no se inventa (YAGNI).
export const patchReglaSchema = z
  .discriminatedUnion("accion", [
    z.object({ accion: z.literal("desactivar") }),
    z.object({ accion: z.literal("editar"), ...camposVigencia }),
  ])
  .superRefine((data, ctx) => {
    if (data.accion === "editar") validarCuerpoRegla(data, ctx);
  });

export type PatchReglaInput = z.infer<typeof patchReglaSchema>;
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run lib/apertura/schemas.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/apertura/schemas.ts lib/apertura/schemas.test.ts
git commit -m "feat(apertura-gastos): agrega schemas Zod para crear/editar reglas"
```

---

### Task 6: `lib/apertura/motor.ts` — orquestadores de aplicación y reversión

**Files:**
- Create: `lib/apertura/motor.ts`

**Interfaces:**
- Consumes: `calcularDistribuciones`, `DestinoPct` de `./calculo` (Task 2); `resolverVigencia`, `vigenciaToSql`, `ReglaVigencia` de `./vigencia` (Task 3).
- Produces: `AperturaDbClient` (tipo local, ver Step 3), `aplicarRegla(prisma: AperturaDbClient, input: AplicarReglaInput): Promise<{ comprasAfectadas: number }>`, `revertirRegla(prisma: AperturaDbClient, reglaId: number): Promise<{ comprasRevertidas: number }>`. Task 7 (route handlers) los invoca dentro de `prisma.$transaction`.

Sin test automatizado — ver Global Constraints y sección 11 del diseño (sin base de test/dev, este módulo ejecuta SQL crudo contra `compras`/`distribuciones_apertura`). La cobertura viene de: (a) los tests ya escritos de `calculo.ts`/`vigencia.ts`, que este módulo solo compone; (b) revisión de código estricta en este task; (c) la verificación manual gateada de la Task 9.

- [ ] **Step 1: Implementar `lib/apertura/motor.ts`**

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { calcularDistribuciones, type DestinoPct } from "./calculo";
import { resolverVigencia, vigenciaToSql, type ReglaVigencia } from "./vigencia";

// Mismo shape que lib/etl/types.ts DbClient, redeclarado localmente para no
// acoplar lib/apertura/ (dominio de negocio) a lib/etl/ (dominio de import) —
// son capas sin relación, Ley de Deméter (CLAUDE.md sección 1). Compatible
// estructuralmente con Prisma.TransactionClient, así que aplicarRegla/
// revertirRegla funcionan igual pasadas directo o dentro de $transaction.
export type AperturaDbClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

// Compras por chunk de INSERT ... VALUES — mismo criterio que
// lib/etl/normalizers/compras.ts (CHUNK_SIZE=500, ~9k params/chunk con la
// forma actual de la tabla, bien por debajo del límite de 65535 de Postgres).
const CHUNK_SIZE = 500;

interface AplicarReglaInput {
  reglaId: number;
  entidadId: string;
  vigencia: ReglaVigencia;
  destinos: DestinoPct[];
}

// Aplica una regla ya persistida: busca las compras vigentes de su concepto,
// calcula y persiste distribuciones_apertura, marca esDistribuido en las
// compras afectadas. Siempre sobre el importe EFECTIVO — ver Global
// Constraints (decisión de negocio 19-ago-2026).
export async function aplicarRegla(
  prisma: AperturaDbClient,
  input: AplicarReglaInput
): Promise<{ comprasAfectadas: number }> {
  const cond = resolverVigencia(input.vigencia);
  const fechaEfectiva = Prisma.sql`COALESCE(c."fechaManual", c.fecha)`;
  const vigenciaSql = vigenciaToSql(cond, fechaEfectiva);

  const compras = await prisma.$queryRaw<{ rowId: string; importeBase: Prisma.Decimal }[]>(Prisma.sql`
    SELECT c."rowId", COALESCE(c."importeManual", c.importe) AS "importeBase"
    FROM compras c
    WHERE COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${input.entidadId}
      AND c."esBloqueado" = false
      AND c.importe IS NOT NULL
      AND ${vigenciaSql}
  `);

  if (compras.length === 0) return { comprasAfectadas: 0 };

  const porcentajePorDestino = new Map(input.destinos.map((d) => [d.id, d.porcentaje]));

  for (let i = 0; i < compras.length; i += CHUNK_SIZE) {
    const chunk = compras.slice(i, i + CHUNK_SIZE);
    const filas: Prisma.Sql[] = [];

    for (const compra of chunk) {
      // Number(x.toString()), no Number(x) directo — mismo patrón que
      // app/api/dashboard/pivot/route.ts (buildPivotData) ya usa para
      // convertir Prisma.Decimal a number de forma segura.
      const importeBase = Number(compra.importeBase.toString());
      const distribuciones = calcularDistribuciones(importeBase, input.destinos);
      for (const d of distribuciones) {
        filas.push(Prisma.sql`(
          ${compra.rowId}, ${input.reglaId}, ${d.destinoId},
          ${importeBase}::numeric, ${porcentajePorDestino.get(d.destinoId)}::numeric,
          ${d.importeCalculado}::numeric
        )`);
      }
    }

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO distribuciones_apertura
        ("compraRowId", "reglaId", "destinoId", "importeOriginal", porcentaje, "importeCalculado")
      VALUES ${Prisma.join(filas)}
    `);
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras
    SET "esDistribuido" = true, "distribuidoEn" = now()
    WHERE "rowId" IN (${Prisma.join(compras.map((c) => c.rowId))})
  `);

  return { comprasAfectadas: compras.length };
}

// Revierte todas las distribuciones de una regla: borra sus filas de
// distribuciones_apertura y recalcula esDistribuido en las compras afectadas
// según si les queda alguna OTRA distribución — más robusto que asumir que no
// puede quedarles ninguna (no depende de que el invariante de no-superposición
// se mantenga perfecto para todos los casos futuros, sección 7 del diseño).
export async function revertirRegla(prisma: AperturaDbClient, reglaId: number): Promise<{ comprasRevertidas: number }> {
  const afectadas = await prisma.$queryRaw<{ rowId: string }[]>(Prisma.sql`
    SELECT DISTINCT "compraRowId" AS "rowId" FROM distribuciones_apertura WHERE "reglaId" = ${reglaId}
  `);

  await prisma.$executeRaw(Prisma.sql`DELETE FROM distribuciones_apertura WHERE "reglaId" = ${reglaId}`);

  if (afectadas.length === 0) return { comprasRevertidas: 0 };

  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras c
    SET
      "esDistribuido" = EXISTS (SELECT 1 FROM distribuciones_apertura da WHERE da."compraRowId" = c."rowId"),
      "distribuidoEn" = CASE
        WHEN EXISTS (SELECT 1 FROM distribuciones_apertura da WHERE da."compraRowId" = c."rowId") THEN c."distribuidoEn"
        ELSE NULL
      END
    WHERE c."rowId" IN (${Prisma.join(afectadas.map((c) => c.rowId))})
  `);

  return { comprasRevertidas: afectadas.length };
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores relacionados a `lib/apertura/motor.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/apertura/motor.ts
git commit -m "feat(apertura-gastos): agrega orquestadores de aplicación y reversión del motor"
```

---

### Task 7: Route handlers — CRUD de `reglas_apertura`

**Files:**
- Create: `app/api/apertura/reglas/route.ts`
- Create: `app/api/apertura/reglas/[id]/route.ts`

**Interfaces:**
- Consumes: `crearReglaSchema`, `patchReglaSchema` de `@/lib/apertura/schemas` (Task 5); `encontrarSuperposicion` de `@/lib/apertura/validaciones` (Task 4); `aplicarRegla`, `revertirRegla` de `@/lib/apertura/motor` (Task 6); `ReglaVigencia` de `@/lib/apertura/vigencia` (Task 3); `requireAuth` de `@/lib/auth/require-auth`; `prisma` de `@/lib/prisma`.

- [ ] **Step 1: Implementar `app/api/apertura/reglas/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { crearReglaSchema } from "@/lib/apertura/schemas";
import { encontrarSuperposicion } from "@/lib/apertura/validaciones";
import { aplicarRegla } from "@/lib/apertura/motor";
import type { ReglaVigencia } from "@/lib/apertura/vigencia";

export const dynamic = "force-dynamic";
// Motor síncrono, sin cola — mismo criterio que app/api/etl/drive-import/route.ts.
// Ver sección 5 del diseño: riesgo aceptado, se revisita si algún concepto real
// se acerca al límite.
export const maxDuration = 60;

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const reglas = await prisma.reglaApertura.findMany({
    include: { destinos: true },
    orderBy: { creadoEn: "desc" },
  });
  return NextResponse.json({ data: reglas });
}

export async function POST(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = crearReglaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 422 });
  }
  const { entidadId, modo, fechaDesde, fechaHasta, extremosInclusivos, destinos } = parsed.data;

  const existentes = await prisma.reglaApertura.findMany({
    where: { entidadId, nivel: "concepto", estado: "activa" },
    select: { id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true },
  });
  const vigenciaNueva: ReglaVigencia = {
    modo,
    fechaDesde: fechaDesde ? new Date(fechaDesde) : null,
    fechaHasta: fechaHasta ? new Date(fechaHasta) : null,
    extremosInclusivos,
  };
  const conflictoId = encontrarSuperposicion(
    vigenciaNueva,
    existentes.map((r) => ({
      id: r.id,
      modo: r.modo as ReglaVigencia["modo"],
      fechaDesde: r.fechaDesde,
      fechaHasta: r.fechaHasta,
      extremosInclusivos: r.extremosInclusivos,
    }))
  );
  if (conflictoId !== null) {
    return NextResponse.json({ error: `Superposición con la regla existente #${conflictoId}` }, { status: 409 });
  }

  try {
    const { regla, comprasAfectadas } = await prisma.$transaction(
      async (tx) => {
        const regla = await tx.reglaApertura.create({
          data: {
            nivel: "concepto",
            entidadId,
            modo,
            fechaDesde: vigenciaNueva.fechaDesde,
            fechaHasta: vigenciaNueva.fechaHasta,
            extremosInclusivos,
            destinos: {
              create: destinos.map((d) => ({
                localId: d.localId ?? null,
                puntoDeVentaId: d.puntoDeVentaId ?? null,
                porcentaje: d.porcentaje,
              })),
            },
          },
          include: { destinos: true },
        });

        const resultado = await aplicarRegla(tx, {
          reglaId: regla.id,
          entidadId,
          vigencia: vigenciaNueva,
          // Number(x.toString()), no Number(x) directo — mismo patrón que pivot usa.
          destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
        });

        return { regla, comprasAfectadas: resultado.comprasAfectadas };
      },
      { timeout: 55000 }
    );

    return NextResponse.json({ data: regla, comprasAfectadas }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/apertura/reglas]", err);
    return NextResponse.json({ error: "Error interno al crear la regla" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implementar `app/api/apertura/reglas/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { patchReglaSchema } from "@/lib/apertura/schemas";
import { encontrarSuperposicion } from "@/lib/apertura/validaciones";
import { aplicarRegla, revertirRegla } from "@/lib/apertura/motor";
import type { ReglaVigencia } from "@/lib/apertura/vigencia";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseId(idRaw: string): number | null {
  const id = Number(idRaw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = patchReglaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 422 });
  }

  const existente = await prisma.reglaApertura.findUnique({ where: { id } });
  if (!existente) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  if (parsed.data.accion === "desactivar") {
    // Solo detiene aplicación futura — distribuciones ya generadas quedan
    // como historial (sección 7 del diseño). No revierte nada.
    const regla = await prisma.reglaApertura.update({ where: { id }, data: { estado: "inactiva" } });
    return NextResponse.json({ data: regla });
  }

  // accion === "editar": la spec pide recalcular todos los registros del
  // período de la regla, incluyendo históricos ("lo que manda es la fecha de
  // la regla siempre"). Se implementa como revertir + reaplicar completo —
  // más simple y correcto que un diff parcial, resultado final idéntico.
  const { modo, fechaDesde, fechaHasta, extremosInclusivos, destinos } = parsed.data;
  const vigenciaNueva: ReglaVigencia = {
    modo,
    fechaDesde: fechaDesde ? new Date(fechaDesde) : null,
    fechaHasta: fechaHasta ? new Date(fechaHasta) : null,
    extremosInclusivos,
  };

  const otras = await prisma.reglaApertura.findMany({
    where: { entidadId: existente.entidadId, nivel: "concepto", estado: "activa", NOT: { id } },
    select: { id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true },
  });
  const conflictoId = encontrarSuperposicion(
    vigenciaNueva,
    otras.map((r) => ({
      id: r.id,
      modo: r.modo as ReglaVigencia["modo"],
      fechaDesde: r.fechaDesde,
      fechaHasta: r.fechaHasta,
      extremosInclusivos: r.extremosInclusivos,
    }))
  );
  if (conflictoId !== null) {
    return NextResponse.json({ error: `Superposición con la regla existente #${conflictoId}` }, { status: 409 });
  }

  try {
    const { regla, comprasAfectadas } = await prisma.$transaction(
      async (tx) => {
        await revertirRegla(tx, id);
        await tx.destinoRegla.deleteMany({ where: { reglaId: id } });

        const regla = await tx.reglaApertura.update({
          where: { id },
          data: {
            modo,
            fechaDesde: vigenciaNueva.fechaDesde,
            fechaHasta: vigenciaNueva.fechaHasta,
            extremosInclusivos,
            destinos: {
              create: destinos.map((d) => ({
                localId: d.localId ?? null,
                puntoDeVentaId: d.puntoDeVentaId ?? null,
                porcentaje: d.porcentaje,
              })),
            },
          },
          include: { destinos: true },
        });

        const resultado = await aplicarRegla(tx, {
          reglaId: regla.id,
          entidadId: existente.entidadId,
          vigencia: vigenciaNueva,
          // Number(x.toString()), no Number(x) directo — mismo patrón que pivot usa.
          destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
        });

        return { regla, comprasAfectadas: resultado.comprasAfectadas };
      },
      { timeout: 55000 }
    );

    return NextResponse.json({ data: regla, comprasAfectadas });
  } catch (err) {
    console.error("[PATCH /api/apertura/reglas/[id]]", err);
    return NextResponse.json({ error: "Error interno al editar la regla" }, { status: 500 });
  }
}

// _request: la firma de un route handler de Next requiere el primer parámetro
// aunque no se use el body — mismo criterio que evitar "any"/silenciar lint,
// se nombra explícitamente en vez de omitirlo.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const existente = await prisma.reglaApertura.findUnique({ where: { id } });
  if (!existente) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

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

    return NextResponse.json({ ok: true, comprasRevertidas });
  } catch (err) {
    console.error("[DELETE /api/apertura/reglas/[id]]", err);
    return NextResponse.json({ error: "Error interno al eliminar la regla" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores relacionados a `app/api/apertura/reglas/`. Si `prisma.$transaction`'s callback `tx` no encaja estructuralmente con `AperturaDbClient` (Task 6), ajustar el tipo de `AperturaDbClient` — no forzar con `as`/`any`.

- [ ] **Step 4: Correr el lint**

Run: `npm run lint`
Expected: sin errores en los archivos nuevos.

- [ ] **Step 5: Commit**

```bash
git add app/api/apertura/reglas
git commit -m "feat(apertura-gastos): agrega CRUD de reglas de apertura vía API"
```

---

### Task 8: Migrar `pivot` y `detalle` a `v_compras_distribuidas`

**Files:**
- Modify: `app/api/dashboard/pivot/route.ts`
- Modify: `app/api/dashboard/detalle/route.ts`
- Modify: `lib/dashboard/types.ts:130-155` (`CompraDetalle`)

**Interfaces:**
- Consumes: la vista `v_compras_distribuidas` (Task 1, columnas documentadas ahí). `buildPivotConditions` (`lib/dashboard/query-builders.ts`) — sin cambios.
- Produces: `CompraDetalle.distribucionId` (nuevo campo, tipo únicamente — ningún componente de UI lo consume todavía, queda documentado para que Fase C no tenga que redescubrirlo).

- [ ] **Step 1: Migrar `pivot` — cambio de una línea**

En `app/api/dashboard/pivot/route.ts`, el único cambio es el `FROM` de la query (línea 55 en la versión actual):

```diff
-    FROM compras c
+    FROM v_compras_distribuidas c
```

El resto del archivo (`buildPivotConditions`, los `LEFT JOIN` a `conceptos_caja`/`rubros_concepto_caja`/`proveedores`, `buildPivotData`) no cambia — todas las columnas que referencia (`c."rowId"`, `c."fechaManual"`, `c.fecha`, `c."importeManual"`, `c.importe`, `c."observacManual"`, `c.observac`, `c."conceptoCodigoManual"`, `c."conceptoCodigo"`, `c."proveedorId"`) existen con el mismo nombre en la vista.

- [ ] **Step 2: Reescribir `detalle` a SQL crudo contra la vista**

`app/api/dashboard/detalle/route.ts` hoy usa `prisma.compra.findMany` con relaciones tipadas — Prisma Client no puede leer una vista SQL sin modelarla (este plan deliberadamente no lo hace, ver Task 1), así que se reescribe a `$queryRaw` con los mismos `LEFT JOIN` que `pivot` ya usa, reconstruyendo en JS la forma anidada que el frontend consume (`CompraDetalle` en `lib/dashboard/types.ts` — sin cambios ahí, la forma de la respuesta se preserva exactamente). Reemplazar el contenido completo de `app/api/dashboard/detalle/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { mesSchema, yearSchema, idSchema, codigoSchema } from "@/lib/dashboard/schemas";
import { buildDateRange } from "@/lib/dashboard/query-builders";

export const dynamic = "force-dynamic";

interface DetalleSqlRow {
  rowId: string;
  distribucionId: number | null;
  fecha: Date | null;
  fechaManual: Date | null;
  importe: Prisma.Decimal | null;
  importeManual: Prisma.Decimal | null;
  conceptoCodigoManual: string | null;
  concepto: string | null;
  detalle: string | null;
  observac: string | null;
  observacManual: string | null;
  proveedorTexto: string | null;
  proveedorId: number | null;
  proveedorNombre: string | null;
  proveedorRazon: string | null;
  localNombre: string | null;
  pdvNombre: string | null;
  conceptoCajaCodigo: string | null;
  conceptoCajaNombre: string | null;
  conceptoCajaRubroNombre: string | null;
  conceptoCajaManualCodigo: string | null;
  conceptoCajaManualNombre: string | null;
  conceptoCajaManualRubroNombre: string | null;
}

function reshapeDetalle(r: DetalleSqlRow) {
  return {
    rowId: r.rowId,
    // distribucionId: null cuando la compra no está distribuida (100% de los
    // casos hasta que exista una regla activa — Fase B no la puede crear sin
    // pasar por la API, ver Task 9). rowId se mantiene SIEMPRE como el de la
    // compra original (no un compuesto) — compra-lineas/[compraId] y el
    // endpoint puntual de compras/[rowId] siguen necesitando el rowId real
    // para funcionar. Fase C es quien debe usar `distribucionId ?? rowId`
    // como key de UI una vez que existan filas distribuidas (riesgo anotado
    // en la sección 4 del diseño, "Riesgo para Fase C").
    distribucionId: r.distribucionId,
    fecha: r.fecha,
    importe: r.importe,
    importeManual: r.importeManual,
    fechaManual: r.fechaManual,
    conceptoCodigoManual: r.conceptoCodigoManual,
    concepto: r.concepto,
    detalle: r.detalle,
    observac: r.observac,
    observacManual: r.observacManual,
    proveedor: r.proveedorTexto,
    proveedorRef: r.proveedorId != null ? { id: r.proveedorId, nombre: r.proveedorNombre, razon: r.proveedorRazon } : null,
    local: r.localNombre != null ? { nombre: r.localNombre } : null,
    puntoDeVenta: r.pdvNombre != null ? { nombre: r.pdvNombre } : null,
    conceptoCaja:
      r.conceptoCajaCodigo != null
        ? { codigo: r.conceptoCajaCodigo, nombre: r.conceptoCajaNombre, rubro: r.conceptoCajaRubroNombre != null ? { nombre: r.conceptoCajaRubroNombre } : null }
        : null,
    conceptoCajaManual:
      r.conceptoCajaManualCodigo != null
        ? {
            codigo: r.conceptoCajaManualCodigo,
            nombre: r.conceptoCajaManualNombre,
            rubro: r.conceptoCajaManualRubroNombre != null ? { nombre: r.conceptoCajaManualRubroNombre } : null,
          }
        : null,
  };
}

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);

  const yearParsed = yearSchema.safeParse(searchParams.get("year") ?? new Date().getFullYear());
  const year = yearParsed.success ? yearParsed.data : new Date().getFullYear();

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
    return NextResponse.json({ data: compra ? [compra] : [] });
  }

  const localId = idSchema.safeParse(searchParams.get("localId")).data;
  const pdvId = idSchema.safeParse(searchParams.get("pdvId")).data;
  const mes = mesSchema.safeParse(searchParams.get("mes")).data;
  const proveedorId = idSchema.safeParse(searchParams.get("proveedorId")).data;

  const conceptoCodigoRaw = searchParams.get("conceptoCodigo");
  const rubroCodigoRaw = searchParams.get("rubroCodigo");
  const conceptoCodigo = conceptoCodigoRaw ? codigoSchema.safeParse(conceptoCodigoRaw).data : undefined;
  const rubroCodigo = rubroCodigoRaw ? codigoSchema.safeParse(rubroCodigoRaw).data : undefined;

  const { fechaStart, fechaEnd } = buildDateRange(year, mes);

  const conditions: Prisma.Sql[] = [
    Prisma.sql`COALESCE(c."fechaManual", c.fecha) >= ${fechaStart} AND COALESCE(c."fechaManual", c.fecha) < ${fechaEnd}`,
    Prisma.sql`(c.fecha IS NOT NULL OR c."fechaManual" IS NOT NULL)`,
    Prisma.sql`COALESCE(c."importeManual", c.importe) IS NOT NULL AND COALESCE(c."importeManual", c.importe) != 0`,
  ];
  if (localId !== undefined) conditions.push(Prisma.sql`c."localId" = ${localId}`);
  if (pdvId !== undefined) conditions.push(Prisma.sql`c."puntoDeVentaId" = ${pdvId}`);
  if (proveedorId !== undefined) conditions.push(Prisma.sql`p.id = ${proveedorId}`);

  // cc_ef/rc_ef (concepto EFECTIVO, mismo join que pivot usa: COALESCE(manual,
  // original)) es solo para filtrar — replica exactamente el comportamiento
  // original de detalle (Prisma: `OR: [{conceptoCodigoManual: X}, {conceptoCodigoManual: null, conceptoCodigo: X}]`)
  // y el de pivot. Filtrar por el concepto NO-coalescido sería un bug: una
  // compra reclasificada a mano a otro rubro/concepto dejaría de aparecer al
  // filtrar por su rubro nuevo, o seguiría apareciendo en el rubro viejo.
  if (rubroCodigo && !conceptoCodigo) {
    conditions.push(Prisma.sql`rc_ef.codigo = ${rubroCodigo}`);
  } else if (conceptoCodigo) {
    conditions.push(Prisma.sql`COALESCE(cc_ef.codigo, '__sin_concepto') = ${conceptoCodigo}`);
  } else {
    // Sin filtro de rubro/concepto: excluir rubros ocultos. A diferencia de
    // los dos filtros de arriba, esta rama del detalle ORIGINAL (antes de
    // este plan) usa el concepto NO-manual (`conceptoCaja`/`conceptoCodigo`
    // en el Prisma.CompraWhereInput anterior) para decidir visibilidad, no el
    // efectivo — replicar exactamente, no "corregir" una inconsistencia que
    // ya existía y está fuera de alcance de este plan.
    conditions.push(Prisma.sql`(rc."visibleEnDashboard" = true OR c."conceptoCodigo" IS NULL)`);
  }

  const where = Prisma.join(conditions, " AND ");

  const rows = await prisma.$queryRaw<DetalleSqlRow[]>(Prisma.sql`
    SELECT
      c."rowId",
      c."distribucionId",
      c.fecha,
      c."fechaManual",
      c.importe,
      c."importeManual",
      c."conceptoCodigoManual",
      c.concepto,
      c.detalle,
      c.observac,
      c."observacManual",
      c.proveedor AS "proveedorTexto",
      p.id                AS "proveedorId",
      p.nombre            AS "proveedorNombre",
      p.razon             AS "proveedorRazon",
      l.nombre            AS "localNombre",
      pdv.nombre          AS "pdvNombre",
      cc.codigo           AS "conceptoCajaCodigo",
      cc.nombre           AS "conceptoCajaNombre",
      rc.nombre           AS "conceptoCajaRubroNombre",
      ccm.codigo          AS "conceptoCajaManualCodigo",
      ccm.nombre          AS "conceptoCajaManualNombre",
      rcm.nombre          AS "conceptoCajaManualRubroNombre"
    FROM v_compras_distribuidas c
    LEFT JOIN proveedores p            ON c."proveedorId" = p.id
    LEFT JOIN locales l                ON c."localId" = l.id
    LEFT JOIN puntos_de_venta pdv      ON c."puntoDeVentaId" = pdv.id
    -- Concepto/rubro EFECTIVO — solo para filtrar (mismo criterio que pivot).
    LEFT JOIN conceptos_caja cc_ef        ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc_ef.codigo
    LEFT JOIN rubros_concepto_caja rc_ef  ON cc_ef."codRga" = rc_ef.codigo
    -- Concepto original y manual POR SEPARADO — para mostrar los dos objetos
    -- anidados que CompraDetalle espera (conceptoCaja / conceptoCajaManual).
    LEFT JOIN conceptos_caja cc           ON c."conceptoCodigo" = cc.codigo
    LEFT JOIN rubros_concepto_caja rc     ON cc."codRga" = rc.codigo
    LEFT JOIN conceptos_caja ccm          ON c."conceptoCodigoManual" = ccm.codigo
    LEFT JOIN rubros_concepto_caja rcm    ON ccm."codRga" = rcm.codigo
    WHERE ${where}
    ORDER BY c.fecha ASC
    LIMIT 2000
  `);

  return NextResponse.json({ data: rows.map(reshapeDetalle) });
}
```

**Fidelidad de comportamiento — no "corregir" al reescribir:** este rewrite preserva exactamente el comportamiento del `detalle` original, incluidas dos particularidades que podrían parecer inconsistencias pero no son parte del alcance de este plan:
- El filtro por `rubroCodigo`/`conceptoCodigo` usa el concepto **efectivo** (`cc_ef`/`rc_ef`, `COALESCE(manual, original)`), pero la rama de visibilidad cuando NO hay ningún filtro activo usa el concepto **no-manual** (`cc`/`rc`) — así era el código original (`Prisma.CompraWhereInput` con `conceptoCaja`/`conceptoCodigo` sin coalescer en esa rama específica). Reescribirla con el efectivo cambiaría cuáles filas aparecen sin filtro activo — fuera de alcance.
- `ORDER BY` usa `c.fecha` (fecha cruda), no la fecha efectiva — así ordenaba el `orderBy: { fecha: "asc" }` original, pese a que el resto del endpoint sí usa la fecha efectiva para filtrar.

- [ ] **Step 3: Agregar `distribucionId` al tipo `CompraDetalle`**

En `lib/dashboard/types.ts`, dentro de `CompraDetalle` (línea ~130), agregar el campo después de `rowId`:

```diff
 export type CompraDetalle = {
   rowId: string;
+  distribucionId: number | null;
   fecha: string | null;
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores relacionados a estos archivos.

- [ ] **Step 5: Correr el lint**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add app/api/dashboard/pivot/route.ts app/api/dashboard/detalle/route.ts lib/dashboard/types.ts
git commit -m "feat(apertura-gastos): migra pivot y detalle a leer de v_compras_distribuidas"
```

---

### Task 9: Aplicar la vista a producción y verificar el motor de punta a punta

**⚠️ Toca la única base de datos real del proyecto — sin entorno de test/dev (ver Global Constraints). Requiere aprobación explícita del usuario antes de ejecutar (CLAUDE.md sección 7). Si el usuario ya dio luz verde end-to-end para este plan en esta sesión, la excepción de CLAUDE.md sección 7 aplica y no hace falta repreguntar paso por paso — PERO cualquier resultado distinto al esperado en cualquier paso detiene la ejecución y se reporta, exactamente como si la excepción no existiera.**

**Files:** ninguno (solo operaciones contra la base de datos real vía Prisma CLI y llamadas HTTP a los endpoints ya creados).

- [ ] **Step 1: Backup**

```bash
pg_dump "$DIRECT_URL" --schema=public --no-owner --no-privileges > backups/pre-apertura-fase-b-$(date +%Y%m%d%H%M%S).sql
```

Verificar que el archivo se creó y pesa un tamaño razonable (comparable al backup de Fase A, ~25MB).

- [ ] **Step 2: Aplicar la migración de la vista**

```bash
npx prisma migrate status
npx prisma migrate deploy
```

Expected: `20260819163000_v_compras_distribuidas` aparece aplicada, sin drift reportado.

- [ ] **Step 3: Verificar la vista devuelve exactamente lo mismo que `compras` (0 reglas activas todavía)**

Conectado a la base con `psql "$DIRECT_URL"` o vía un script disponible con `getEtlClient()`:

```sql
SELECT COUNT(*), SUM(importe) FROM compras;
SELECT COUNT(*), SUM(importe) FROM v_compras_distribuidas;
```

Expected: mismo conteo y misma suma en ambas — sin reglas activas, la vista es una copia 1:1 de `compras` (rama `esDistribuido = false` cubre el 100% de las filas).

- [ ] **Step 4: Elegir un concepto de bajo volumen para la prueba real**

```sql
SELECT "conceptoCodigo", COUNT(*) FROM compras
WHERE "conceptoCodigo" IS NOT NULL AND "esBloqueado" = false
GROUP BY "conceptoCodigo"
ORDER BY COUNT(*) ASC
LIMIT 10;
```

Elegir un concepto con pocas compras (idealmente 1-5) para minimizar el radio de impacto de la prueba. Anotar su código y el rango de fechas de sus compras.

- [ ] **Step 5: Crear una regla de prueba vía la API real**

Con sesión autenticada (mismo mecanismo que cualquier request al dashboard), `POST /api/apertura/reglas`:

```json
{
  "entidadId": "<código elegido en Step 4>",
  "modo": "historico",
  "confirmarHistorico": true,
  "destinos": [
    { "localId": <id de un local real>, "porcentaje": 60 },
    { "localId": <id de otro local real>, "porcentaje": 40 }
  ]
}
```

Expected: `201`, `comprasAfectadas` coincide con el conteo del Step 4.

- [ ] **Step 6: Verificar el estado en base**

```sql
SELECT COUNT(*) FROM distribuciones_apertura WHERE "reglaId" = <id devuelto>;
SELECT "rowId", "esDistribuido" FROM compras WHERE "conceptoCodigo" = '<código>';
SELECT SUM("importeCalculado") FROM distribuciones_apertura WHERE "reglaId" = <id>;
SELECT SUM(importe) FROM compras WHERE "conceptoCodigo" = '<código>';
```

Expected: `esDistribuido = true` en todas; suma de `importeCalculado` = suma de `importe` original (invariante no negociable); `v_compras_distribuidas` para ese concepto ahora devuelve el doble de filas (fan-out 2 destinos) con la suma total sin cambios.

- [ ] **Step 7: Verificar el límite conocido — desactivar + regla nueva superpuesta**

Hallazgo de la revisión de Task 7 (ver ledger): desactivar una regla deja sus `distribuciones_apertura`/`esDistribuido=true` como historial (correcto, a propósito), pero como el chequeo de superposición solo mira reglas `estado: activa`, una regla NUEVA para el mismo concepto/período pasa la validación y luego el motor la salta (esas compras ya están `esDistribuido=true` por la regla vieja) — resultado: `201` con `comprasAfectadas: 0`, sin error. Verificar que este comportamiento documentado se sostiene, no que sea "corregido" (no hay fix de código para esto en este plan — ver ruling de Task 7):

1. `PATCH /api/apertura/reglas/<id de Step 5>` con `{ "accion": "desactivar" }`. Expected: `200`, `estado: "inactiva"`.
2. `SELECT COUNT(*) FROM distribuciones_apertura WHERE "reglaId" = <id>;` — Expected: sigue habiendo filas (no se revirtió, es historial).
3. `POST /api/apertura/reglas` con el mismo `entidadId`/`modo: "historico"`/`confirmarHistorico: true` y los mismos destinos que Step 5. Expected: `201` (pasa la validación de superposición porque la vieja está inactiva), pero `comprasAfectadas: 0` — confirma el límite documentado, no un bug nuevo. Anotar el `id` de esta regla nueva como `<id2>`.

- [ ] **Step 8: Revertir ambas reglas de prueba**

`DELETE /api/apertura/reglas/<id2>` (la nueva, sin distribuciones — `comprasRevertidas: 0`), luego `DELETE /api/apertura/reglas/<id>` (la original, Step 5) — Expected en la segunda: `200`, `comprasRevertidas` coincide con el Step 4.

- [ ] **Step 9: Verificar reversión completa**

```sql
SELECT COUNT(*) FROM distribuciones_apertura WHERE "reglaId" IN (<id>, <id2>);
SELECT "esDistribuido", "distribuidoEn" FROM compras WHERE "conceptoCodigo" = '<código>';
SELECT COUNT(*), SUM(importe) FROM compras;
SELECT COUNT(*), SUM(importe) FROM v_compras_distribuidas;
```

Expected: 0 filas en `distribuciones_apertura` para ambas reglas; `esDistribuido = false`, `distribuidoEn = null` en todas las compras del concepto; conteo/suma de `compras` vs `v_compras_distribuidas` vuelven a coincidir exactamente (mismo resultado que el Step 3 — el sistema queda en el mismo estado que antes de la prueba).

- [ ] **Step 10: Sanity check final**

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: todos los tests pasan (los nuevos de `lib/apertura/` + los ya existentes), lint y tsc limpios.

- [ ] **Step 11: Documentar el cierre de Fase B**

Guardar una memoria de proyecto nueva (`project_apertura_gastos_fase_b_estado.md`, mismo patrón que `project_apertura_gastos_fase_a_estado.md`) con: qué se aplicó, resultado de la verificación end-to-end (Steps 5-9, incluyendo el límite conocido de desactivar+regla nueva confirmado en el Step 7), y que Fase C (UI) sigue pendiente.
