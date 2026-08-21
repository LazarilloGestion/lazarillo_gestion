# Log centralizado del proceso de importación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir cada corrida de import (una fila por archivo procesado, exitoso o fallido) en una tabla nueva `import_logs`, para que un caso como el bug de compras duplicadas de esta misma semana sea diagnosticable sin queries ad-hoc contra producción.

**Architecture:** Modelo Prisma nuevo `ImportLog` (tabla `import_logs`, cambio aditivo puro — sin tocar tablas existentes). La escritura vive en `app/api/etl/drive-import/route.ts` (único entry point de import del proyecto), no dentro de `lib/etl/run-etl.ts` — mantiene `runETL` puro/testeable. Dos `prisma.importLog.create(...)`, cada uno en su propio try/catch best-effort: uno en el camino de éxito (mapea el `ETLReport` que ya devuelve `runETL`), otro en el camino de error ya existente (excepción de `runETL` a mitad de archivo).

**Tech Stack:** Next.js 16 + Prisma 7 (adapter-pg) + Postgres/Supabase + TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-08-21-log-importaciones-design.md`

## Global Constraints

- Cambio aditivo puro — tabla nueva, sin `ALTER` sobre tablas existentes, sin riesgo de pérdida de datos (spec sección 5).
- El registro del log es best-effort — un fallo al escribir el `ImportLog` NUNCA debe tirar abajo el import real ni cambiar el status code de la respuesta HTTP (spec sección 4.2 y 5).
- Sin UI nueva, sin loguear el resultado de `sincronizarTrasImport`, sin job de limpieza/retención — fuera de alcance de este v1 (spec sección 2).
- `fileType` es `String?` en el schema (no un enum de Prisma) — mismo criterio que `ReglaApertura.nivel`/`modo`/`estado` ya usado en este repo (spec sección 4.1).
- Sin test unitario dedicado — no hay lógica pura nueva, es un mapeo 1:1 de `ETLReport` a `ImportLog` sin transformación (spec sección 6).

---

### Task 1: Modelo `ImportLog` y migración de Prisma

**Files:**
- Modify: `prisma/schema.prisma` (agregar modelo al final del archivo, después de `DistribucionApertura`)
- Create: migración generada por Prisma en `prisma/migrations/<timestamp>_add_import_logs/migration.sql` (no se escribe a mano — la genera `prisma migrate dev`)

**Interfaces:**
- Consumes: nada (tabla nueva, sin relaciones a otros modelos).
- Produces: `prisma.importLog` en el cliente generado, con los campos `id`, `batchId`, `fileType`, `fileName`, `storagePath`, `localId`, `puntoDeVentaId`, `estado`, `totalRows`, `created`, `updated`, `skipped`, `errors`, `skippedRows`, `errorMessage`, `durationMs`, `triggeredBy`, `creadoEn` — Task 2 los consume.

- [ ] **Step 1: Agregar el modelo a `prisma/schema.prisma`**

Al final del archivo (después del cierre de `model DistribucionApertura { ... }`), agregar:

```prisma

// ─── AUDITORÍA ────────────────────────────────────────────────────────────────

model ImportLog {
  id      Int    @id @default(autoincrement())
  batchId String // uuid, uno por POST — correlaciona los archivos de un mismo import

  fileType    String? // ETLFileType; null si el archivo no llegó a detectarse
  fileName    String
  storagePath String?

  localId        Int?
  puntoDeVentaId Int?

  estado    String // 'ok' | 'error'
  totalRows Int?
  created   Int?
  updated   Int?
  skipped   Int?

  errors       Json?   // ETLRowError[] tal cual los arma runETL
  skippedRows  Json?   // ETLSkippedRow[] tal cual
  errorMessage String? // solo cuando estado='error' (excepción de runETL, no llegó a haber report)

  durationMs Int?

  triggeredBy String // user.id de requireAuthUser()
  creadoEn    DateTime @default(now())

  @@index([batchId])
  @@index([fileType, creadoEn])
  @@map("import_logs")
}
```

- [ ] **Step 2: Generar y aplicar la migración**

Este es el paso sensible de esta task — toca el schema de la base. Es un `CREATE TABLE` puramente aditivo (tabla nueva, sin `ALTER` sobre tablas existentes, sin FKs a otras tablas), pero de todas formas: confirmar con el usuario antes de correr el Step 3 contra producción (este Step 2 solo aplica en local/dev vía `migrate dev`; la promoción a producción real es un paso aparte fuera de este plan, vía el flujo ya establecido de `dev` → `main`).

```bash
npx prisma migrate dev --name add_import_logs
```

Expected: termina sin errores, imprime algo como `Applying migration '...add_import_logs'` y genera el archivo `prisma/migrations/<timestamp>_add_import_logs/migration.sql` con un `CREATE TABLE "import_logs" (...)`. `migrate dev` corre `prisma generate` automáticamente al final.

- [ ] **Step 3: Verificar que el cliente generado incluye `importLog`**

```bash
npx tsc --noEmit -p . 2>&1 | grep -i "importLog" || echo "sin errores de tipos relacionados a importLog"
grep -c "importLog" node_modules/.prisma/client/index.d.ts
```

Expected: el segundo comando devuelve un número mayor a 0 (el tipo `ImportLog`/`importLog` aparece en el cliente generado). El primer comando no debe listar errores sobre `importLog` (en este punto todavía no hay código que lo use, así que no debería haber ninguno de todas formas — es una verificación de que el modelo compiló, no de integración).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat(import-log): agrega modelo ImportLog y migración add_import_logs

Tabla nueva import_logs, cambio aditivo puro — sin tocar tablas
existentes. Prepara la escritura del log centralizado de imports
(Task 2 de este plan).
EOF
)"
```

---

### Task 2: Escribir el log desde `POST /api/etl/drive-import`

**Files:**
- Modify: `app/api/etl/drive-import/route.ts`

**Interfaces:**
- Consumes: `prisma.importLog.create(...)` producido en Task 1; `ETLReport` de `lib/etl/types.ts` (ya importado en el archivo, línea 17: `import type { ETLContext, ETLReport, DbClient } from "@/lib/etl/types";`); `user.id` de `requireAuthUser()` (ya disponible en la función, línea 86: `const { user } = auth;`); `localId`/`puntoDeVentaId` (ya disponibles, líneas 100-101).
- Produces: nada que otra task consuma — es el final de esta feature.

- [ ] **Step 1: Agregar `batchId` al principio del `POST`**

En `app/api/etl/drive-import/route.ts`, ubicar el bloque actual (después de la validación del body, antes de armar `fileInputs`):

```ts
  const body = parsed.data;

  const fileInputs: FileInput[] = body.files ?? [{ file_id: body.file_id!, file_name: body.file_name! }];
```

Reemplazar por:

```ts
  const body = parsed.data;
  const batchId = crypto.randomUUID();

  const fileInputs: FileInput[] = body.files ?? [{ file_id: body.file_id!, file_name: body.file_name! }];
```

(`crypto.randomUUID()` es global de Node, disponible en el runtime `nodejs` que esta ruta ya declara en la línea 21 — no hace falta ningún `import` nuevo.)

- [ ] **Step 2: Loguear el camino de éxito**

Ubicar el bloque actual (dentro del `for` que procesa cada archivo, líneas ~200-217):

```ts
      let report: ETLReport;
      try {
        // Sin transacción global: cada chunk del normalizer hace su propio commit.
        // ON CONFLICT DO UPDATE garantiza idempotencia → reimports seguros.
        // Una transacción única de 55 s causaba timeout y rollback total en archivos grandes.
        report = await runETL(buffer, storagePath, ctx, getEtlClient() as unknown as DbClient);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        const aperturaParcial = await sincronizarAperturaSiCorresponde(reports);
        if (aperturaParcial.errores.length > 0) {
          console.error("[POST /api/etl/drive-import] apertura.errores (batch parcial)", aperturaParcial.errores);
        }
        return NextResponse.json(
          { error: `Error procesando el archivo: ${message}`, reports, apertura: aperturaParcial },
          { status: 422 }
        );
      }
      reports.push(report);
```

Reemplazar por:

```ts
      let report: ETLReport;
      try {
        // Sin transacción global: cada chunk del normalizer hace su propio commit.
        // ON CONFLICT DO UPDATE garantiza idempotencia → reimports seguros.
        // Una transacción única de 55 s causaba timeout y rollback total en archivos grandes.
        report = await runETL(buffer, storagePath, ctx, getEtlClient() as unknown as DbClient);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        try {
          await prisma.importLog.create({
            data: {
              batchId,
              fileType: null,
              fileName: file_name,
              localId,
              puntoDeVentaId,
              estado: "error",
              errorMessage: message,
              triggeredBy: user.id,
            },
          });
        } catch (logErr) {
          console.error("[POST /api/etl/drive-import] Falló el registro del ImportLog (camino error), se sigue sin loguear", { userId: user.id, file_name }, logErr);
        }
        const aperturaParcial = await sincronizarAperturaSiCorresponde(reports);
        if (aperturaParcial.errores.length > 0) {
          console.error("[POST /api/etl/drive-import] apertura.errores (batch parcial)", aperturaParcial.errores);
        }
        return NextResponse.json(
          { error: `Error procesando el archivo: ${message}`, reports, apertura: aperturaParcial },
          { status: 422 }
        );
      }
      try {
        await prisma.importLog.create({
          data: {
            batchId,
            fileType: report.fileType,
            fileName: file_name,
            storagePath: report.storagePath,
            localId,
            puntoDeVentaId,
            estado: "ok",
            totalRows: report.totalRows,
            created: report.created,
            updated: report.updated,
            skipped: report.skipped,
            errors: report.errors,
            skippedRows: report.skippedRows,
            durationMs: report.durationMs,
            triggeredBy: user.id,
          },
        });
      } catch (logErr) {
        console.error("[POST /api/etl/drive-import] Falló el registro del ImportLog, se sigue sin loguear", { userId: user.id, file_name }, logErr);
      }
      reports.push(report);
```

Nota: el `try/catch` del camino de error queda anidado dentro del `catch (err)` ya existente — es intencional, mantiene el `create` de ese camino en su propio try/catch best-effort sin alterar el flujo de la excepción original (`message` sigue viajando igual a la respuesta 422 de siempre).

- [ ] **Step 3: Verificación de tipos**

```bash
npx tsc --noEmit
```

Expected: sin errores. Si aparece un error de tipos sobre `errors`/`skippedRows` (Prisma `Json` esperando `InputJsonValue` en vez de `ETLRowError[]`/`ETLSkippedRow[]`), es porque esos arrays pueden venir `undefined` en el `ETLReport` (`skippedRows?: ETLSkippedRow[]` es opcional) — Prisma acepta `undefined` para omitir el campo, así que no debería hacer falta ningún cast; si `tsc` igual se queja, usar `report.errors ?? []` y `report.skippedRows ?? undefined` en el `data` de arriba y volver a correr este step.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: sin errores ni warnings nuevos.

- [ ] **Step 5: Tests**

```bash
npx vitest run
```

Expected: mismo resultado que antes de esta task (289/289 o el conteo vigente en ese momento) — esta feature no agrega tests nuevos (spec sección 6, no hay lógica pura que testear), así que el número de tests no debería cambiar.

- [ ] **Step 6: Commit**

```bash
git add app/api/etl/drive-import/route.ts
git commit -m "$(cat <<'EOF'
feat(import-log): escribe ImportLog en cada archivo procesado por drive-import

Un create por archivo (éxito o error), cada uno en su propio
try/catch best-effort — un fallo al loguear nunca debe romper el
import real. batchId (uuid) correlaciona los archivos de un mismo
POST.
EOF
)"
```

---

## Verificación post-implementación (manual, fuera de estas tasks)

No hay ambiente de test separado en este proyecto — la verificación final de que el log realmente aparece en producción requiere una corrida real de import post-deploy (spec sección 6). Esto NO es parte de este plan (que solo cubre el código y la migración local/dev) — queda para cuando el usuario decida promover este trabajo a producción, siguiendo el mismo flujo ya usado en los sub-proyectos anteriores (build limpio → confirmación explícita → push → deploy → verificación).

## Elección de ejecución

Plan chico (2 tasks, ambas secuenciales — Task 2 depende del cliente Prisma generado en Task 1) y de bajo riesgo (cambio aditivo, sin tocar datos existentes). Tiene sentido ejecutarlo **inline** vía `executing-plans` en vez de `subagent-driven-development` — el overhead de dispatch por task no se justifica para 2 tasks tan chicas y ya con el código literal escrito. Aun así, la decisión es del usuario.
