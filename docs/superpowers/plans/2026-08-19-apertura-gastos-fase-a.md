# Apertura de Gastos — Fase A: Identidad de compra + Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la identidad (`rowId`) de `Compra` para que un cambio de importe en el ERP se trate como actualización del mismo registro cuando hay comprobante, y agregar el modelo de datos de Apertura de Gastos al schema — sin tocar todavía el motor de reglas ni el dashboard (eso es Fase B).

**Architecture:** Se extrae la lógica de identidad de compra a un módulo puro y compartido (`lib/etl/normalizers/compra-identity.ts`) con dos adaptadores — uno para filas crudas de Excel (ETL en vivo) y otro para registros ya persistidos (`Compra` en DB) — que alimentan la misma función de hash. Esto garantiza que el `rowId` que calcula el ETL al reimportar un archivo coincida exactamente con el `rowId` que le asigna el script de migración a una compra ya existente. El schema de Prisma suma 3 tablas nuevas (`reglas_apertura`, `destinos_regla`, `distribuciones_apertura`) y 3 columnas en `Compra` (`esDistribuido`, `distribuidoEn`, `esBloqueado`), sin lógica de negocio todavía — son la base sobre la que Fase B construye el motor de reglas.

**Tech Stack:** TypeScript estricto, Prisma 7 (`adapter-pg`), PostgreSQL vía Supabase, vitest para tests unitarios.

**Spec:** `docs/superpowers/specs/2026-08-19-apertura-gastos-design.md` (secciones 2 y 3)

## Global Constraints

- TypeScript en modo estricto; nada de `any` sin comentario de justificación.
- Toda query a la base pasa por Prisma — no `pg` directo.
- Manejo de errores explícito, nunca `catch {}` vacío — este proyecto maneja datos financieros.
- Tests con vitest, aislados y determinísticos, sin base de datos real (usar `createMockDb`/mocks de `lib/etl/test-utils/`).
- Conventional Commits en cada paso de commit.
- Correr `npm run lint` y `npm run test` antes de dar cualquier tarea por cerrada.
- **No hay entornos separados dev/prod** — un solo Supabase, local y Vercel apuntan a la misma base (ver memoria `project_alta_nunez_comercio`). Cualquier migración de Prisma se genera con `--create-only` primero para revisar el SQL antes de aplicarlo — nunca `prisma migrate dev` directo contra esta base.
- Ningún paso de este plan que aplique una migración o corra el script de migración de `rowId` contra la base real se ejecuta sin aprobación explícita del usuario en esa sesión — no alcanza con la aprobación del plan.
- No sumar dependencias nuevas.

---

## Task 1: Módulo de identidad de compra compartido

**Files:**
- Create: `lib/etl/normalizers/compra-identity.ts`
- Create: `lib/etl/normalizers/compra-identity.test.ts`

**Interfaces:**
- Consumes: `trim`, `normalizeText`, `excelDateToISO`, `toDecimalStr` de `lib/etl/helpers.ts` (ya existen, firmas sin cambios); `ETLRow` de `lib/etl/types.ts`.
- Produces: `parseComprobanteFromDetalle(raw: unknown): string | null`, `computeCompraRowId(input: CompraIdentityInput): string`, `compraIdentityFromRawRow(r: ETLRow): CompraIdentityInput`, `compraIdentityFromDbRecord(c: CompraDbIdentitySource): CompraIdentityInput`, y el tipo `CompraIdentityInput`. Task 2 y Task 4 importan estos símbolos.

- [ ] **Step 1: Escribir el test de la propiedad crítica (equivalencia raw-row vs db-record)**

Crear `lib/etl/normalizers/compra-identity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  parseComprobanteFromDetalle,
  computeCompraRowId,
  compraIdentityFromRawRow,
  compraIdentityFromDbRecord,
} from "./compra-identity";
import type { ETLRow } from "../types";

describe("parseComprobanteFromDetalle", () => {
  it("parsea 'A 0606-00761530' al formato compacto con zero-padding", () => {
    expect(parseComprobanteFromDetalle("A 0606-00761530")).toBe("A060600761530");
  });

  it("aplica el alias TIC -> Z", () => {
    expect(parseComprobanteFromDetalle("TIC 0001-00000042")).toBe("Z000100000042");
  });

  it("devuelve null si no matchea el formato esperado", () => {
    expect(parseComprobanteFromDetalle("sin comprobante")).toBeNull();
    expect(parseComprobanteFromDetalle(null)).toBeNull();
  });
});

describe("computeCompraRowId", () => {
  it("con comprobante: dos inputs que solo difieren en importe dan el mismo rowId", () => {
    const base = {
      codCga: "GASTO1", fechaISO: "2026-03-15", codigo: "PROV1", concepto: "Alquiler",
      comprobante: "A060600761530", detalle: "A 0606-00761530", observacNormalizado: "Obs", importe: "1000",
    };
    const a = computeCompraRowId(base);
    const b = computeCompraRowId({ ...base, importe: "1200" });
    expect(a).toBe(b);
  });

  it("sin comprobante: dos inputs que solo difieren en importe dan rowId distinto", () => {
    const base = {
      codCga: "GASTO1", fechaISO: "2026-03-15", codigo: "PROV1", concepto: "Sueldos",
      comprobante: null, detalle: null, observacNormalizado: "Juan", importe: "1000",
    };
    const a = computeCompraRowId(base);
    const b = computeCompraRowId({ ...base, importe: "1200" });
    expect(a).not.toBe(b);
  });

  it("sin comprobante: dos inputs idénticos dan el mismo rowId (dedup real)", () => {
    const base = {
      codCga: "GASTO1", fechaISO: "2026-03-15", codigo: "PROV1", concepto: "Sueldos",
      comprobante: null, detalle: null, observacNormalizado: "Juan", importe: "1000",
    };
    expect(computeCompraRowId(base)).toBe(computeCompraRowId({ ...base }));
  });
});

describe("compraIdentityFromRawRow / compraIdentityFromDbRecord — equivalencia", () => {
  // Esta es la propiedad que garantiza que reimportar el mismo archivo produce
  // el mismo rowId que el que la migración le asignó a la compra ya existente.
  it("con comprobante: identidad calculada desde la fila cruda == identidad calculada desde el registro ya persistido", () => {
    const rawRow: ETLRow = {
      COD_CGA: "GASTO1",
      FECHA: 45000, // serial Excel, ~2023-03-15
      CODIGO: "PROV1",
      CONCEPTO: "Alquiler",
      DETALLE: "A 0606-00761530",
      OBSERVAC: "observación   con   espacios",
      IMPORTE: 1000,
    };

    const dbRecord = {
      codCga: "Gasto1",
      fecha: new Date("2023-03-15"),
      codigo: "PROV1",
      concepto: "Alquiler",
      comprobante: "A060600761530",
      detalle: "A 0606-00761530",
      observac: "Observación Con Espacios", // ya normalizado por normalizeText al insertar
      importe: { toString: () => "1000" }, // shape de Prisma.Decimal
    };

    const fromRaw = computeCompraRowId(compraIdentityFromRawRow(rawRow));
    const fromDb = computeCompraRowId(compraIdentityFromDbRecord(dbRecord));
    expect(fromRaw).toBe(fromDb);
  });

  it("sin comprobante: identidad calculada desde la fila cruda == identidad calculada desde el registro ya persistido", () => {
    const rawRow: ETLRow = {
      COD_CGA: "GASTO2",
      FECHA: 45000,
      CODIGO: "EMP5",
      CONCEPTO: "Liquidacion Sueldo",
      DETALLE: null,
      OBSERVAC: "juan perez",
      IMPORTE: 250000,
    };

    const dbRecord = {
      codCga: "GASTO2",
      fecha: new Date("2023-03-15"),
      codigo: "EMP5",
      concepto: "Liquidacion Sueldo",
      comprobante: null,
      detalle: null,
      observac: "Juan Perez",
      importe: { toString: () => "250000" },
    };

    const fromRaw = computeCompraRowId(compraIdentityFromRawRow(rawRow));
    const fromDb = computeCompraRowId(compraIdentityFromDbRecord(dbRecord));
    expect(fromRaw).toBe(fromDb);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/etl/normalizers/compra-identity.test.ts`
Expected: FAIL — `Cannot find module './compra-identity'` (el archivo todavía no existe).

- [ ] **Step 3: Implementar el módulo**

Crear `lib/etl/normalizers/compra-identity.ts`:

```typescript
import { createHash } from "crypto";
import { trim, normalizeText, excelDateToISO, toDecimalStr } from "../helpers";
import type { ETLRow } from "../types";

// Códigos del ERP en compras que difieren del COD_CPB en detalle_compras.
const CODE_ALIASES: Record<string, string> = {
  TIC: "Z",
};

// Convierte "A 0606-00761530" → "A060600761530" (mismo formato que detalle_compras.comprobante)
export function parseComprobanteFromDetalle(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const match = s.match(/^(\S+)\s+(\d+)-(\d+)$/);
  if (!match) return null;
  const [, cod, num1, num2] = match;
  const normalizedCod = CODE_ALIASES[cod.toUpperCase()] ?? cod.toUpperCase();
  return normalizedCod + num1.padStart(4, "0") + num2.padStart(8, "0");
}

export interface CompraIdentityInput {
  codCga: string | null;
  fechaISO: string | null; // YYYY-MM-DD, canónico entre fila cruda y registro persistido
  codigo: string | null;
  concepto: string | null;
  comprobante: string | null;
  detalle: string | null;
  observacNormalizado: string | null;
  importe: string | null; // decimal como string, anti-drift de punto flotante
}

// Identidad partida: si hay comprobante parseable (documento real del ERP), el
// hash NO incluye importe — un cambio de importe para el mismo comprobante debe
// tratarse como actualización del mismo registro, no como transacción nueva
// (spec Apertura de Gastos, sección 10 / CA-12). Sin comprobante (~40% de las
// filas: sueldos, alquiler, gastos sueltos) no hay forma de distinguir una
// corrección de una transacción distinta con los mismos campos descriptivos, así
// que se preserva el comportamiento anterior con IMPORTE incluido en el hash.
export function computeCompraRowId(input: CompraIdentityInput): string {
  const keyParts = input.comprobante
    ? [input.codCga, input.fechaISO, input.codigo, input.concepto, input.comprobante]
    : [input.codCga, input.fechaISO, input.codigo, input.concepto, input.detalle, input.observacNormalizado, input.importe];
  const key = keyParts.map((v) => v ?? "").join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

// Adaptador para una fila cruda del Excel del ERP (ETL en vivo). Los campos se
// normalizan igual que lo hace compraRowSchema (trim/normalizeText) para que el
// resultado sea idéntico al de compraIdentityFromDbRecord sobre el mismo dato ya
// persistido — es la propiedad que garantiza que reimportar el mismo archivo
// actualiza el registro existente en vez de crear uno nuevo.
export function compraIdentityFromRawRow(r: ETLRow): CompraIdentityInput {
  return {
    codCga: trim(r["COD_CGA"]),
    fechaISO: excelDateToISO(r["FECHA"]),
    codigo: trim(r["CODIGO"]),
    concepto: trim(r["CONCEPTO"]),
    comprobante: parseComprobanteFromDetalle(r["DETALLE"]),
    detalle: trim(r["DETALLE"]),
    observacNormalizado: normalizeText(r["OBSERVAC"]),
    importe: toDecimalStr(r["IMPORTE"]),
  };
}

export interface CompraDbIdentitySource {
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  comprobante: string | null;
  detalle: string | null;
  observac: string | null;
  importe: { toString(): string } | null; // shape de Prisma.Decimal
}

// Adaptador para una compra ya persistida (usado por el script de migración de
// rowId). fecha se recompone a ISO desde el Date almacenado — safeDate() en el
// ETL siempre construye el Date a partir de un string 'YYYY-MM-DD' (medianoche
// UTC), así que toISOString().slice(0,10) reconstruye el mismo string exacto.
export function compraIdentityFromDbRecord(c: CompraDbIdentitySource): CompraIdentityInput {
  return {
    codCga: c.codCga,
    fechaISO: c.fecha ? c.fecha.toISOString().slice(0, 10) : null,
    codigo: c.codigo,
    concepto: c.concepto,
    comprobante: c.comprobante,
    detalle: c.detalle,
    observacNormalizado: c.observac,
    importe: c.importe != null ? toDecimalStr(c.importe.toString()) : null,
  };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/etl/normalizers/compra-identity.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sin errores en los archivos nuevos.

- [ ] **Step 6: Commit**

```bash
git add lib/etl/normalizers/compra-identity.ts lib/etl/normalizers/compra-identity.test.ts
git commit -m "feat(etl): agrega módulo de identidad de compra compartido (rowId partido con/sin comprobante)"
```

---

## Task 2: Migrar `normalizeCompras` al módulo de identidad compartido

**Files:**
- Modify: `lib/etl/normalizers/compras.ts:1-52` (imports + elimina `CODE_ALIASES`, `parseComprobanteFromDetalle`, `makeRowId` locales, importa del módulo nuevo; `formatFechaDisplay` se mantiene sin cambios de contenido, solo se reordena en el bloque de reemplazo)
- Modify: `lib/etl/normalizers/compras.test.ts` (agrega tests del nuevo comportamiento de reimportación)

**Interfaces:**
- Consumes: `parseComprobanteFromDetalle`, `computeCompraRowId`, `compraIdentityFromRawRow` de `./compra-identity` (Task 1).
- Produces: `normalizeCompras` mantiene exactamente la misma firma pública — este task no cambia su interfaz, solo su implementación interna de `rowId`.

- [ ] **Step 1: Escribir los tests nuevos (reimportación con comprobante actualiza, sin comprobante sigue duplicando)**

Agregar a `lib/etl/normalizers/compras.test.ts`, dentro del `describe("normalizeCompras", ...)` existente:

```typescript
  it("con comprobante: reimportar la misma fila con importe distinto actualiza el registro (mismo rowId), no duplica", async () => {
    const db = createMockDb();
    const first = await normalizeCompras([baseRow({ DETALLE: "A 0606-00761530" })], db);
    expect(first.created).toBe(1);

    const compraModel = { findMany: vi.fn() };
    mockAllExisting(compraModel, "rowId");
    const dbReimport = createMockDb({ compra: compraModel });
    const second = await normalizeCompras(
      [baseRow({ DETALLE: "A 0606-00761530", IMPORTE: 5000 })],
      dbReimport
    );
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
  });

  it("sin comprobante: dos filas iguales salvo IMPORTE se siguen insertando como transacciones distintas", async () => {
    const db = createMockDb();
    const res = await normalizeCompras(
      [baseRow({ DETALLE: null, IMPORTE: 100 }), baseRow({ DETALLE: null, IMPORTE: 200 })],
      db
    );
    expect(res.created).toBe(2);
  });
```

- [ ] **Step 2: Correr los tests para verificar que el primero falla**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: FAIL en "con comprobante: reimportar..." — con la lógica actual, cambiar IMPORTE cambia el `rowId` (porque hoy siempre está incluido en el hash), así que `second.created` da 1 en vez de 0.

- [ ] **Step 3: Refactorizar `compras.ts` para usar el módulo compartido**

En `lib/etl/normalizers/compras.ts`, reemplazar (líneas 1-45 aproximadamente, desde los imports hasta el fin de `makeRowId`):

```typescript
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim, toDecimalStr, excelDateToISO } from "../helpers";
import { linkDetalleComprasByComprobante } from "../normalizer-utils";
import { compraRowSchema, type CompraRow } from "../schemas/compras";
import { formatZodError } from "../schemas/common";
import { parseComprobanteFromDetalle, computeCompraRowId, compraIdentityFromRawRow } from "./compra-identity";

import type { ETLRow, ETLRowError, ETLContext, ETLSkippedRow } from "../types";

// Filas por chunk de INSERT ... ON CONFLICT. Con ~18 columnas: ~9k params/chunk < 65535.
const CHUNK_SIZE = 500;

function formatFechaDisplay(val: unknown): string | undefined {
  const iso = excelDateToISO(val);
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Identidad partida (con/sin comprobante) delegada a compra-identity.ts — ver ese
// módulo para el porqué. Opera SIEMPRE sobre la fila cruda (ETLRow), nunca sobre
// datos ya coercionados por Zod, para que el resultado sea reproducible por el
// script de migración de rowId (que reconstruye la misma identidad desde la
// compra ya persistida, no desde el Excel original).
function makeRowId(r: ETLRow): string {
  return computeCompraRowId(compraIdentityFromRawRow(r));
}
```

Nota: el bloque de arriba ya refleja los imports correctos tras el refactor — `createHash` y `normalizeText` se eliminan del import de este archivo (se mudaron a `compra-identity.ts` y ya no se usan acá); `trim`, `toDecimalStr` y `excelDateToISO` se mantienen porque siguen usándose más abajo en `normalizeCompras` (líneas 71, 74-76, 98-100 del archivo original) y en `formatFechaDisplay`. `CODE_ALIASES` y `parseComprobanteFromDetalle` locales también se eliminan de este archivo — la llamada existente a `parseComprobanteFromDetalle(row["DETALLE"])` más abajo (construcción de `rowValues`, columna `comprobante`) sigue funcionando igual, ahora resuelta por el import desde `./compra-identity`.

Revisar el resto de `lib/etl/normalizers/compras.ts` para confirmar que ningún otro punto referencia `CODE_ALIASES` (queda solo en `compra-identity.ts`) y que la llamada existente a `parseComprobanteFromDetalle(row["DETALLE"])` en la construcción de `rowValues` (búsqueda del texto `parseComprobanteFromDetalle` más abajo en el archivo) sigue funcionando con el import nuevo desde `./compra-identity`.

- [ ] **Step 4: Correr los tests para verificar que todos pasan**

Run: `npx vitest run lib/etl/normalizers/compras.test.ts`
Expected: PASS — todos los tests, incluidos los 2 nuevos del Step 1.

- [ ] **Step 5: Correr la suite completa de ETL para descartar regresiones**

Run: `npx vitest run lib/etl/`
Expected: PASS en todos los normalizers (compras, detalle-compras, ventas, etc. no deberían verse afectados).

- [ ] **Step 6: Lint**

Run: `npm run lint`

- [ ] **Step 7: Commit**

```bash
git add lib/etl/normalizers/compras.ts lib/etl/normalizers/compras.test.ts
git commit -m "refactor(etl): normalizeCompras usa el módulo de identidad compartido — reimport con comprobante actualiza en vez de duplicar"
```

---

## Task 3: Schema de Prisma — tablas de Apertura de Gastos

**Files:**
- Modify: `prisma/schema.prisma` (agrega modelos nuevos y campos en `Compra`)
- Create: migración generada por Prisma en `prisma/migrations/<timestamp>_apertura_gastos_schema/migration.sql` (generada por el comando del Step 2, no escrita a mano)

**Interfaces:**
- Produces: modelos `ReglaApertura`, `DestinoRegla`, `DistribucionApertura` y campos `Compra.esDistribuido: Boolean`, `Compra.distribuidoEn: DateTime?`, `Compra.esBloqueado: Boolean` — Fase B (motor de reglas, fuera de este plan) los consume.

- [ ] **Step 1: Agregar los modelos al schema**

En `prisma/schema.prisma`, agregar los campos nuevos al modelo `Compra` (después de `observacManual` en la sección de overrides manuales, línea ~182):

```prisma
  // Apertura de Gastos — ver docs/superpowers/specs/2026-08-19-apertura-gastos-design.md
  esDistribuido Boolean   @default(false)
  distribuidoEn DateTime?
  esBloqueado   Boolean   @default(false)

  distribuciones DistribucionApertura[]
```

Agregar al final del archivo (después del modelo `FlujoCajaManual`), una nueva sección:

```prisma
// ─── APERTURA DE GASTOS ────────────────────────────────────────────────────

model ReglaApertura {
  id     Int    @id @default(autoincrement())
  nivel  String // 'concepto' en v1; 'proveedor' | 'registro' reservados para versiones futuras
  entidadId String // código de ConceptoCaja en v1

  modo               String // 'historico' | 'entre_fechas' | 'desde_adelante' | 'desde_atras'
  fechaDesde         DateTime?
  fechaHasta         DateTime?
  extremosInclusivos Boolean   @default(true)

  estado    String   @default("activa") // 'activa' | 'inactiva'
  creadoPor String?
  creadoEn  DateTime @default(now())

  destinos       DestinoRegla[]
  distribuciones DistribucionApertura[]

  @@index([entidadId, nivel])
  @@map("reglas_apertura")
}

model DestinoRegla {
  id             Int     @id @default(autoincrement())
  reglaId        Int
  localId        Int?
  puntoDeVentaId Int?
  porcentaje     Decimal @db.Decimal(5, 2)

  regla        ReglaApertura @relation(fields: [reglaId], references: [id])
  local        Local?        @relation(fields: [localId], references: [id])
  puntoDeVenta PuntoDeVenta? @relation(fields: [puntoDeVentaId], references: [id])

  distribuciones DistribucionApertura[]

  @@index([reglaId])
  @@map("destinos_regla")
}

model DistribucionApertura {
  id               Int      @id @default(autoincrement())
  compraRowId      String
  reglaId          Int
  destinoId        Int
  importeOriginal  Decimal  @db.Decimal(14, 2)
  porcentaje       Decimal  @db.Decimal(5, 2)
  importeCalculado Decimal  @db.Decimal(14, 2)
  procesadoEn      DateTime @default(now())

  compra  Compra        @relation(fields: [compraRowId], references: [rowId])
  regla   ReglaApertura @relation(fields: [reglaId], references: [id])
  destino DestinoRegla  @relation(fields: [destinoId], references: [id])

  @@index([compraRowId])
  @@map("distribuciones_apertura")
}
```

Agregar también las relaciones inversas en `Local` y `PuntoDeVenta` (junto a las relaciones existentes como `compras`, `ventas`):

En `model Local`, agregar: `destinosRegla DestinoRegla[]`
En `model PuntoDeVenta`, agregar: `destinosRegla DestinoRegla[]`

- [ ] **Step 2: Generar la migración SIN aplicarla**

Run: `npx prisma migrate dev --name apertura_gastos_schema --create-only`
Expected: crea `prisma/migrations/<timestamp>_apertura_gastos_schema/migration.sql` sin tocar la base de datos (flag `--create-only`). Confirmar en la salida del comando que dice "have NOT been applied".

- [ ] **Step 3: Revisar el SQL generado a mano**

Leer el archivo de migración generado. Confirmar que:
- Crea las 3 tablas nuevas con los nombres mapeados (`reglas_apertura`, `destinos_regla`, `distribuciones_apertura`).
- Agrega las 3 columnas nuevas a `compras` con sus defaults: `esDistribuido` boolean default false, `distribuidoEn` timestamp nullable, `esBloqueado` boolean default false. Estos nombres van tal cual en camelCase (comillas dobles en el SQL, ej. `"esDistribuido"`) — igual que el resto de las columnas de `compras` (`fechaManual`, `importeManual`, `localId`, etc.), que no usan `@map` a snake_case en ningún campo, solo `@@map` en el nombre de la tabla. Si el SQL generado muestra snake_case en vez de camelCase para estas columnas nuevas, hay un `@map` de más en el schema del Step 1 — corregirlo y regenerar.
- No incluye ningún `DROP` ni cambio sobre tablas existentes fuera de los `ADD COLUMN` esperados en `compras`.

Si algo no coincide con lo esperado, corregir el schema (Step 1) y regenerar (no editar el SQL a mano).

- [ ] **Step 4: Generar el cliente de Prisma (sin aplicar la migración)**

Run: `npx prisma generate`
Expected: el cliente TypeScript incluye los tipos `ReglaApertura`, `DestinoRegla`, `DistribucionApertura` y los campos nuevos en `Compra` — esto no requiere que la migración esté aplicada contra la base real, solo lee `schema.prisma`.

- [ ] **Step 5: Verificar el build de TypeScript**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos atribuibles a este cambio (el proyecto puede tener warnings preexistentes no relacionados — comparar contra el estado antes de este task si hace falta).

- [ ] **Step 6: Commit (schema + migración generada, todavía sin aplicar)**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): agrega modelo de datos de Apertura de Gastos (reglas_apertura, destinos_regla, distribuciones_apertura)

Migración generada con --create-only, todavía no aplicada contra la base de producción."
```

**Nota explícita:** este commit NO aplica la migración contra la base real. Ver Task 5 para el paso de aplicación, que requiere aprobación explícita separada.

---

## Task 4: Script de migración de `rowId`

**Files:**
- Create: `scripts/migrate-rowid-compras.ts`
- Create: `scripts/migrate-rowid-compras.test.ts`

**Interfaces:**
- Consumes: `computeCompraRowId`, `compraIdentityFromDbRecord` de `lib/etl/normalizers/compra-identity.ts` (Task 1).
- Produces: función pura `planRowIdMigration(compras: CompraForMigration[]): RowIdMigrationPlan[]` (testable sin DB) + función `main()` que la usa contra la base real, invocada solo por CLI.

- [ ] **Step 1: Escribir el test de la función pura de planificación**

Crear `scripts/migrate-rowid-compras.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { planRowIdMigration } from "./migrate-rowid-compras";

describe("planRowIdMigration", () => {
  it("calcula un rowId nuevo distinto del actual cuando la fórmula cambia el resultado", () => {
    const compras = [
      {
        rowId: "hash-viejo-1",
        codCga: "GASTO1",
        fecha: new Date("2026-03-15"),
        codigo: "PROV1",
        concepto: "Alquiler",
        comprobante: "A060600761530",
        detalle: "A 0606-00761530",
        observac: "Obs",
        importe: { toString: () => "1000" },
      },
    ];
    const plan = planRowIdMigration(compras);
    expect(plan).toHaveLength(1);
    expect(plan[0].rowIdViejo).toBe("hash-viejo-1");
    expect(plan[0].rowIdNuevo).not.toBe("hash-viejo-1");
    expect(plan[0].rowIdNuevo).toMatch(/^[0-9a-f]{24}$/);
  });

  it("no genera un plan de migración duplicado si dos compras distintas ya comparten rowIdNuevo (colisión) — se marca para revisión manual", () => {
    const filaBase = {
      codCga: "GASTO1",
      fecha: new Date("2026-03-15"),
      codigo: "PROV1",
      concepto: "Alquiler",
      comprobante: "A060600761530",
      detalle: "A 0606-00761530",
      observac: "Obs",
      importe: { toString: () => "1000" },
    };
    const compras = [
      { ...filaBase, rowId: "hash-viejo-1" },
      { ...filaBase, rowId: "hash-viejo-2", importe: { toString: () => "2000" } }, // con comprobante, importe no entra al hash -> misma identidad
    ];
    const plan = planRowIdMigration(compras);
    const colisiones = plan.filter((p) => p.colision);
    expect(colisiones.length).toBeGreaterThan(0);
  });

  it("es idempotente: si el rowId ya es el nuevo formato, no lo incluye en el plan", () => {
    const compra = {
      rowId: "hash-viejo-1",
      codCga: "GASTO1",
      fecha: new Date("2026-03-15"),
      codigo: "PROV1",
      concepto: "Alquiler",
      comprobante: "A060600761530",
      detalle: "A 0606-00761530",
      observac: "Obs",
      importe: { toString: () => "1000" },
    };
    const primerPlan = planRowIdMigration([compra]);
    const yaMigrada = { ...compra, rowId: primerPlan[0].rowIdNuevo };
    const segundoPlan = planRowIdMigration([yaMigrada]);
    expect(segundoPlan).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run scripts/migrate-rowid-compras.test.ts`
Expected: FAIL — el módulo no existe todavía.

- [ ] **Step 3: Implementar `planRowIdMigration` y el script completo**

Crear `scripts/migrate-rowid-compras.ts`:

```typescript
/**
 * migrate-rowid-compras.ts
 *
 * Recalcula el rowId de cada compra existente con la identidad partida
 * (con/sin comprobante, ver lib/etl/normalizers/compra-identity.ts) y actualiza
 * compras.rowId + detalle_compras.compraId en la misma transacción por fila.
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar los UPDATE contra la base real.
 *
 * Uso:
 *   npx tsx scripts/migrate-rowid-compras.ts             # dry-run
 *   npx tsx scripts/migrate-rowid-compras.ts --apply      # aplica de verdad
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "../lib/prisma";
import { computeCompraRowId, compraIdentityFromDbRecord } from "../lib/etl/normalizers/compra-identity";

interface CompraForMigration {
  rowId: string;
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  comprobante: string | null;
  detalle: string | null;
  observac: string | null;
  importe: { toString(): string } | null;
}

export interface RowIdMigrationPlan {
  rowIdViejo: string;
  rowIdNuevo: string;
  colision: boolean; // true si rowIdNuevo coincide con el de otra compra en el mismo plan
}

// Función pura, testable sin base de datos real — separa "qué hay que cambiar"
// de "cómo se aplica el cambio".
export function planRowIdMigration(compras: CompraForMigration[]): RowIdMigrationPlan[] {
  const nuevos = compras.map((c) => ({
    rowIdViejo: c.rowId,
    rowIdNuevo: computeCompraRowId(compraIdentityFromDbRecord(c)),
  }));

  const conteoNuevos = new Map<string, number>();
  for (const n of nuevos) {
    conteoNuevos.set(n.rowIdNuevo, (conteoNuevos.get(n.rowIdNuevo) ?? 0) + 1);
  }

  return nuevos
    .filter((n) => n.rowIdNuevo !== n.rowIdViejo)
    .map((n) => ({ ...n, colision: (conteoNuevos.get(n.rowIdNuevo) ?? 0) > 1 }));
}

async function main() {
  const apply = process.argv.includes("--apply");

  const totalAntes = await prisma.compra.count();
  const totalDetalleAntes = await prisma.detalleCompra.count();
  const sumaImporteAntes = await prisma.compra.aggregate({ _sum: { importe: true } });

  console.log(`\n=== Estado antes de migrar ===`);
  console.log(`Compras: ${totalAntes} · Detalle compras: ${totalDetalleAntes} · Suma importe: ${sumaImporteAntes._sum.importe}`);

  const compras = await prisma.compra.findMany({
    select: {
      rowId: true, codCga: true, fecha: true, codigo: true, concepto: true,
      comprobante: true, detalle: true, observac: true, importe: true,
    },
  });

  const plan = planRowIdMigration(compras);
  const colisiones = plan.filter((p) => p.colision);

  console.log(`\n=== Plan de migración ===`);
  console.log(`Compras a actualizar: ${plan.length} de ${compras.length}`);
  console.log(`Colisiones detectadas (requieren revisión manual antes de aplicar): ${colisiones.length}`);

  if (colisiones.length > 0) {
    console.log("\n⚠ Hay colisiones — no se aplica nada. Revisar estas filas a mano:");
    console.log(JSON.stringify(colisiones.slice(0, 20), null, 2));
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry-run — no se escribió nada. Re-ejecutar con --apply para aplicar.\n");
    const fs = await import("fs");
    fs.writeFileSync("rowid-migration-plan.json", JSON.stringify(plan, null, 2));
    console.log("Plan completo guardado en rowid-migration-plan.json\n");
    return;
  }

  console.log("\nAplicando...");
  let actualizadas = 0;
  for (const { rowIdViejo, rowIdNuevo } of plan) {
    await prisma.$transaction([
      prisma.detalleCompra.updateMany({ where: { compraId: rowIdViejo }, data: { compraId: rowIdNuevo } }),
      prisma.compra.update({ where: { rowId: rowIdViejo }, data: { rowId: rowIdNuevo } }),
    ]);
    actualizadas++;
  }

  const totalDespues = await prisma.compra.count();
  const totalDetalleDespues = await prisma.detalleCompra.count();
  const sumaImporteDespues = await prisma.compra.aggregate({ _sum: { importe: true } });
  const huerfanas = await prisma.detalleCompra.count({ where: { compraId: { not: null }, compra: null } });

  console.log(`\n=== Verificación post-migración ===`);
  console.log(`Compras actualizadas: ${actualizadas}`);
  console.log(`Compras: ${totalDespues} (antes ${totalAntes}) · Detalle: ${totalDetalleDespues} (antes ${totalDetalleAntes})`);
  console.log(`Suma importe: ${sumaImporteDespues._sum.importe} (antes ${sumaImporteAntes._sum.importe})`);
  console.log(`Detalle_compras huérfanas: ${huerfanas}`);

  if (totalDespues !== totalAntes || totalDetalleDespues !== totalDetalleAntes || huerfanas > 0) {
    console.error("\n⚠ VERIFICACIÓN FALLÓ — revisar antes de continuar con cualquier otro paso.\n");
    process.exit(1);
  }

  console.log("\nMigración completada y verificada.\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run scripts/migrate-rowid-compras.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Lint**

Run: `npm run lint`

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-rowid-compras.ts scripts/migrate-rowid-compras.test.ts
git commit -m "feat(scripts): agrega script de migración de rowId (dry-run por defecto, detecta colisiones antes de aplicar)"
```

**Nota explícita:** este task solo escribe y testea el script. No lo ejecuta contra la base real — eso es Task 5.

---

## Task 5: Aplicar contra producción (gate humano — requiere aprobación explícita en el momento)

Este task no se ejecuta como parte normal del flujo de tareas. **Antes de cada paso, pedir confirmación explícita al usuario en esa sesión** — la aprobación del plan completo no cuenta como aprobación para este paso (regla de Global Constraints y CLAUDE.md sección 7: cualquier cambio que toque compras/ventas ya importadas se pregunta antes de ejecutar).

- [ ] **Step 1: Backup manual antes de cualquier escritura**

Confirmar que existe un backup reciente y restaurable de la base (Supabase permite backups point-in-time — verificar con el usuario que están habilitados, o hacer un `pg_dump` manual del schema `public` antes de continuar).

- [ ] **Step 2: Aplicar la migración de schema (Task 3)**

Con aprobación explícita del usuario:

Run: `npx prisma migrate deploy`
Expected: aplica la migración `apertura_gastos_schema` generada en Task 3. Verificar con `npx prisma migrate status` que quedó aplicada y no hay drift.

- [ ] **Step 3: Dry-run del script de rowId (Task 4)**

Run: `npx tsx scripts/migrate-rowid-compras.ts`
Expected: reporta el plan sin aplicar nada, guarda `rowid-migration-plan.json`. Revisar el número de compras a actualizar (esperado: cercano a 9.508, ver corrección de alcance en el spec) y confirmar que no hay colisiones.

Si hay colisiones: **detener acá**, revisar las filas señaladas a mano con el usuario antes de seguir — no forzar la aplicación.

- [ ] **Step 4: Aplicar el script de rowId**

Con aprobación explícita del usuario, después de revisar el dry-run:

Run: `npx tsx scripts/migrate-rowid-compras.ts --apply`
Expected: termina con "Migración completada y verificada." Si la verificación post-migración falla (conteos no coinciden, huérfanas > 0), el script termina con exit code 1 — **no continuar**, investigar antes de cualquier otra acción.

- [ ] **Step 5: Verificación funcional post-migración**

Confirmar en el dashboard en producción (login real, no solo tests) que el pivot de Compras sigue mostrando los mismos totales que antes de la migración para al menos un local/año conocido — comparar contra una captura o los totales ya verificados en la corroboración de memoria del 2026-08-19 (9.508 compras, 57.614 ventas, 11.271 detalle_compras).

- [ ] **Step 6: Documentar el cierre de Fase A**

Actualizar la memoria de proyecto (`project_apertura_gastos_spec.md` o una memoria nueva de seguimiento) con la fecha real de aplicación y los conteos de verificación — deja registro para cuando arranque Fase B.
