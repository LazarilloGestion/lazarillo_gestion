# Particionar archivos grandes en import de Drive — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evitar el timeout de Vercel (60s) al importar carpetas de Drive con muchos
archivos (ej. Ramos Mejía, 36 archivos), particionando el envío en tandas más chicas
en vez de un solo POST gigante.

**Architecture:** `hooks/use-drive-import.ts` parte `files[]` en tandas de 5 y hace
un `POST /api/etl/drive-import` secuencial por tanda, reusando `parseImportResponse`
(ya existe) para cada respuesta. El servidor no cambia — `linkDetalleCompras` y
`sincronizarAperturaSiCorresponde` ya son idempotentes y operan sobre todo el local
en la base, no sobre "esta request", así que correrlos una vez por tanda es seguro.
Si una tanda falla, las tandas siguientes de esa carpeta no se intentan (mismo
comportamiento de hoy, ahora a nivel tanda en vez de carpeta completa). La UI ya
renderiza el estado por archivo individual, así que el progreso incremental
("12/36 importados") sale de agregar un contador derivado, sin estado nuevo.

**Tech Stack:** Next.js 16 + React 19 + TypeScript 5, Vitest para tests unitarios.

**Spec:** `docs/superpowers/specs/2026-09-28-chunking-import-drive-design.md`

## Global Constraints

- Tamaño de tanda: **5 archivos por request** (spec sección 3).
- `linkDetalleCompras`/`sincronizarAperturaSiCorresponde` corren **una vez por
  tanda**, no acumulados hasta el final de la carpeta (spec sección 3 y 4.1) — el
  servidor NO se modifica para esto.
- Si una tanda falla (excepción real de `runETL` o error de red), se frena el resto
  de la carpeta — las tandas ya iniciadas/completadas quedan como están (spec
  sección 3).
- Ningún caller de `importFiles` (`importOneFile`, `importAllFiles`, `importarTodo`,
  el botón "Importar N" de `DriveFolder`) cambia su firma ni su forma de llamar —
  la partición es un detalle interno de `importFiles` (spec sección 4.2).
- No agregar dependencias nuevas (CLAUDE.md sección 7).
- Correr `npm run lint`, `npx tsc --noEmit` y `npm run build` antes de dar por
  cerrada la tarea (CLAUDE.md sección 7).

---

### Task 1: Función de partición `chunk`

**Files:**
- Create: `lib/chunk.ts`
- Test: `lib/chunk.test.ts`

**Interfaces:**
- Produces: `chunk<T>(items: T[], size: number): T[][]` — usada por Task 2.

- [ ] **Step 1: Write the failing test**

Crear `lib/chunk.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { chunk } from "./chunk";

describe("chunk", () => {
  it("array vacío -> sin tandas", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("menos elementos que el tamaño de tanda -> una sola tanda con todos", () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it("exactamente el tamaño de tanda -> una sola tanda completa", () => {
    expect(chunk([1, 2, 3, 4, 5], 5)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it("más de una tanda con resto no exacto -> la última tanda queda incompleta", () => {
    const items = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(chunk(items, 5)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12],
    ]);
  });

  it("preserva el orden original dentro y entre tandas", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(chunk(items, 2)).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/chunk.test.ts`
Expected: FAIL — `Cannot find module './chunk'` (el archivo `lib/chunk.ts` todavía no existe).

- [ ] **Step 3: Write minimal implementation**

Crear `lib/chunk.ts`:

```typescript
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/chunk.test.ts`
Expected: PASS — 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/chunk.ts lib/chunk.test.ts
git commit -m "feat(etl): agrega utilidad chunk() para particionar arrays en tandas"
```

---

### Task 2: Particionar `importFiles` en `hooks/use-drive-import.ts`

**Files:**
- Modify: `hooks/use-drive-import.ts:49-122` (comentario + función `importFiles`)

**Interfaces:**
- Consumes: `chunk<T>(items: T[], size: number): T[][]` de `lib/chunk.ts` (Task 1).
  Consumes: `parseImportResponse(files: DriveFile[], ok: boolean, json): ParsedImportResponse`
  de `hooks/parse-import-response.ts` (ya existe, sin cambios — mismo contrato que
  hoy, ahora llamado una vez por tanda con `batch` en vez de `files`).
- Produces: `importFiles(files: DriveFile[], localId?: number, puntoDeVentaId?: number): Promise<{ errors: number; unsupported: number; total: number; records: number }>`
  — **misma firma que ya existe hoy**, ningún caller cambia.

No hay test automatizado para este archivo: usa `useState`/React y el stack no
tiene `jsdom`/`testing-library` (mismo criterio que ya aplica hoy — el archivo no
tiene tests unitarios antes de este cambio tampoco). Se verifica con `tsc`, `lint`,
y una pasada manual en navegador (Task 4).

- [ ] **Step 1: Reemplazar el comentario y el cuerpo de `importFiles`**

En `hooks/use-drive-import.ts`, reemplazar desde el comentario que empieza en
`// Un solo POST con files[] para todo el lote...` (línea 49) hasta el cierre de
la función `importFiles` (línea 122) por:

```typescript
  const CHUNK_SIZE = 5;

  // Se particiona en tandas de CHUNK_SIZE en vez de mandar toda la carpeta en un
  // solo POST — una carpeta con muchos archivos (ej. Ramos Mejía, 36 tras sumar
  // años homologados el 27/28-sep-2026) podía superar el maxDuration=60 de
  // app/api/etl/drive-import/route.ts, cortando la respuesta después de que el
  // import ya había commiteado todo en la base (confirmado: "Vercel Runtime
  // Timeout Error: Task timed out after 60 seconds" — ver
  // docs/superpowers/specs/2026-09-28-chunking-import-drive-design.md).
  // linkDetalleCompras/sincronizarAperturaSiCorresponde corren una vez por tanda
  // (no acumulados hasta el final de la carpeta) — son idempotentes y operan
  // sobre todo el local en la base, no sobre "esta request", así que repetirlos
  // más seguido es seguro.
  //
  // Si una tanda falla (excepción real de runETL, o error de red), las tandas
  // siguientes de esa carpeta no se intentan — mismo comportamiento que ya existía
  // a nivel carpeta completa, ahora a nivel tanda.
  async function importFiles(files: DriveFile[], localId?: number, puntoDeVentaId?: number): Promise<{ errors: number; unsupported: number; total: number; records: number }> {
    if (files.length === 0) return { errors: 0, unsupported: 0, total: 0, records: 0 };

    setFileStatuses((s) => {
      const n = { ...s };
      for (const f of files) n[f.id] = "importing";
      return n;
    });

    let totalErrors = 0;
    let totalUnsupported = 0;
    let totalRecords = 0;
    let aborted = false;

    for (const batch of chunk(files, CHUNK_SIZE)) {
      if (aborted) {
        const notAttempted: FileStates = {};
        const notAttemptedErrors: FileErrors = {};
        for (const f of batch) {
          notAttempted[f.id] = "error";
          notAttemptedErrors[f.id] = "No se llegó a procesar: otra tanda del mismo lote falló antes.";
        }
        totalErrors += batch.length;
        setFileStatuses((s) => ({ ...s, ...notAttempted }));
        setFileErrors((s) => ({ ...s, ...notAttemptedErrors }));
        continue;
      }

      let finalStatuses: FileStates = {};
      let finalErrors: FileErrors = {};
      let finalReports: Record<string, ETLReport> = {};
      let chunkFailed = false;

      try {
        const res = await fetch("/api/etl/drive-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: batch.map((f) => ({ file_id: f.id, file_name: f.name })),
            local_id: localId,
            punto_de_venta_id: puntoDeVentaId,
          }),
        });
        const json = await res.json();
        notificarApertura(json.apertura);

        const parsed = parseImportResponse(batch, res.ok, json);
        finalStatuses = parsed.statuses;
        finalErrors = parsed.errors;
        finalReports = parsed.reports;
        totalErrors += parsed.errorCount;
        totalUnsupported += parsed.unsupportedCount;
        totalRecords += parsed.recordCount;
        if (!res.ok) chunkFailed = true;
      } catch {
        for (const f of batch) {
          finalStatuses[f.id] = "error";
          finalErrors[f.id] = "Error de red";
        }
        totalErrors += batch.length;
        chunkFailed = true;
      }

      setFileStatuses((s) => ({ ...s, ...finalStatuses }));
      setFileReports((s) => {
        const n = { ...s };
        for (const [fileId, report] of Object.entries(finalReports)) n[fileId] = [report];
        return n;
      });
      setFileErrors((s) => {
        const n = { ...s };
        for (const [fileId, msg] of Object.entries(finalErrors)) n[fileId] = msg;
        for (const [fileId, status] of Object.entries(finalStatuses)) {
          if (status === "success") delete n[fileId];
        }
        return n;
      });

      if (chunkFailed) aborted = true;
    }

    return { errors: totalErrors, unsupported: totalUnsupported, total: files.length, records: totalRecords };
  }
```

- [ ] **Step 2: Agregar el import de `chunk`**

Al inicio de `hooks/use-drive-import.ts`, junto a los otros imports:

```typescript
import { chunk } from "@/lib/chunk";
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Correr toda la suite de tests (nada debe romperse)**

Run: `npx vitest run`
Expected: todos los tests pasan (incluye `lib/chunk.test.ts` de Task 1 y
`hooks/parse-import-response.test.ts`, que no cambia).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add hooks/use-drive-import.ts
git commit -m "feat(etl): particiona el import de Drive en tandas de 5 archivos"
```

---

### Task 3: Progreso incremental en `DriveFolder`

**Files:**
- Modify: `app/(shell)/importar/drive-folder.tsx:85-98`

**Interfaces:**
- Consumes: `files: DriveFile[]`, `fileStatuses: FileStates` (props ya existentes
  del componente, sin cambios).

Sin test automatizado (componente de UI, sin `jsdom`/`testing-library` en el stack
— mismo criterio que el resto de este archivo). Se verifica con `tsc`, `lint`, y la
pasada manual de Task 4.

- [ ] **Step 1: Agregar el contador derivado**

En `app/(shell)/importar/drive-folder.tsx`, justo después de la línea que define
`folderImporting` (línea 68: `const folderImporting = files.some((f) => fileStatuses[f.id] === "importing");`), agregar:

```typescript
  // Mismo criterio que allDone: success/unsupported son estados terminales.
  const importedCount = files.filter((f) => fileStatuses[f.id] === "success" || fileStatuses[f.id] === "unsupported").length;
```

- [ ] **Step 2: Mostrar el contador junto al spinner de la carpeta**

Reemplazar:

```tsx
              {(folderImporting || batchRunning) && (
                <Spinner size="sm" />
              )}
```

por:

```tsx
              {(folderImporting || batchRunning) && (
                <span className="flex items-center gap-1.5">
                  <Spinner size="sm" />
                  <span className="text-xs text-zinc-400 font-mono">
                    {importedCount}/{files.length} importados
                  </span>
                </span>
              )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "app/(shell)/importar/drive-folder.tsx"
git commit -m "feat(importar): muestra progreso incremental por tanda en cada carpeta"
```

---

### Task 4: Verificación final

**Files:** ninguno (solo comandos de verificación + prueba manual).

- [ ] **Step 1: Build completo**

Run: `npm run build`
Expected: compila sin errores (corre `prisma generate` + build de Next.js).

- [ ] **Step 2: Suite completa de tests**

Run: `npx vitest run`
Expected: todos los tests pasan, 0 failures.

- [ ] **Step 3: Typecheck y lint completos**

Run: `npx tsc --noEmit && npm run lint`
Expected: ambos sin errores.

- [ ] **Step 4: Pasada manual en navegador**

Levantar `npm run dev`, entrar a `/importar`, y hacer un import real de una carpeta
con más de 5 archivos (ej. una de las carpetas de Ramos Mejía con 36 archivos, o
cualquier carpeta de prueba con >5 archivos si no se quiere tocar datos reales de
Ramos todavía). Confirmar:
- El contador "X/N importados" avanza de a 5 en 5 (o menos en la última tanda) en
  vez de saltar de golpe al final.
- Si la carpeta entera termina bien, no aparece ningún error de conexión aunque
  tenga muchos archivos.
- Si se fuerza una falla en una tanda (ej. desconectar la red a mitad de camino),
  las tandas siguientes quedan marcadas con "No se llegó a procesar: otra tanda
  del mismo lote falló antes." y no se siguen intentando.

Si este paso no se puede completar (sin acceso a una sesión de Drive real), decirlo
explícitamente en vez de asumir que funciona — no reclamar la tarea cerrada sin
esta verificación o sin haberla marcado como pendiente.

- [ ] **Step 5: Commit final (si hubo cambios sueltos, ej. fixes de la pasada manual)**

Solo si Step 4 encontró algo para corregir. Si todo pasó limpio en los Tasks
anteriores, no hay nada que commitear acá.
