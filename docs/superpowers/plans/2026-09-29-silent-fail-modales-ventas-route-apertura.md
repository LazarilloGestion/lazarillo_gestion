# Silent-Fail: Modales de Edición Manual + Ruta de Ventas + Cascada de Apertura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar 3 hallazgos de silent-fail en dato financiero que quedaron fuera del plan de ETL (2026-09-28/29): (1) un input transitorio inválido en los modales de edición manual de compras/ventas borra en silencio el override existente en vez de rechazar el guardado; (2) el PATCH de ventas traga errores no esperados sin dejar rastro en logs; (3) cuando la cascada de reaplicación de reglas de apertura falla por completo tras un DELETE, la respuesta al cliente es indistinguible de "0 errores" y la UI nunca lee ese campo de todas formas.

**Architecture:** Se extrae un helper puro y testeable (`parseImporteManual`) para reemplazar el `parseFloat` inline duplicado en ambos modales — la validación de "¿es un número válido?" vive en `lib/dashboard/`, no en el componente, siguiendo la separación de capas de CLAUDE.md §1. Los otros dos fixes son puntuales, sin abstracción nueva.

**Tech Stack:** TypeScript, React (client components), Next.js route handlers, Vitest.

**Spec:** No hay doc de spec separado — el contrato surge de CLAUDE.md §2 (ningún error de import/parseo/guardado de dato financiero puede fallar en silencio) y de los hallazgos ya verificados contra el código actual (no contra un review viejo — ver nota de cada tarea si el estado real difirió de lo esperado).

## Global Constraints

- CLAUDE.md §2: ningún error de guardado de dato financiero puede fallar en silencio.
- No agregar dependencias nuevas (no hay infraestructura de testing de componentes React en este proyecto — `lib/dashboard/parse-importe-manual.ts` se testea con Vitest puro porque es una función sin DOM; los cambios en los `.tsx` no llevan test automatizado, ver nota en Task 5).
- No modificar código fuera del alcance de este plan.
- Correr `npm test`, `npm run lint` y `npm run build` al final.

---

### Task 1: Helper `parseImporteManual`

**Files:**
- Create: `lib/dashboard/parse-importe-manual.ts`
- Test: `lib/dashboard/parse-importe-manual.test.ts`

**Interfaces:**
- Produces: `parseImporteManual(raw: string): { ok: true; value: number | null } | { ok: false }` — consumido por Task 2 y Task 3.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/dashboard/parse-importe-manual.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseImporteManual } from "./parse-importe-manual";

describe("parseImporteManual", () => {
  it("string vacío: ok, value null (borra el override)", () => {
    expect(parseImporteManual("")).toEqual({ ok: true, value: null });
  });

  it("número entero: ok, value numérico", () => {
    expect(parseImporteManual("1000")).toEqual({ ok: true, value: 1000 });
  });

  it("número decimal: ok, value numérico", () => {
    expect(parseImporteManual("1000.50")).toEqual({ ok: true, value: 1000.5 });
  });

  it("número negativo: ok, value numérico (caso válido real)", () => {
    expect(parseImporteManual("-500")).toEqual({ ok: true, value: -500 });
  });

  it("input transitorio inválido ('-' solo, mientras el usuario escribe un negativo): ok false, no silenciosamente null", () => {
    expect(parseImporteManual("-")).toEqual({ ok: false });
  });

  it("texto no numérico: ok false", () => {
    expect(parseImporteManual("abc")).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/dashboard/parse-importe-manual.test.ts`
Expected: FAIL con "Cannot find module './parse-importe-manual'" (el archivo de implementación todavía no existe).

- [ ] **Step 3: Escribir la implementación mínima**

Crear `lib/dashboard/parse-importe-manual.ts`:

```ts
export type ParseImporteManualResult =
  | { ok: true; value: number | null }
  | { ok: false };

// Un input transitorio inválido (ej. "-" solo, mientras el usuario todavía
// está escribiendo un número negativo) hace que parseFloat devuelva NaN. Sin
// este chequeo, JSON.stringify serializa NaN como null y el PATCH interpreta
// null como "borrar el override manual" — silenciosamente pisa un valor real
// con nada (CLAUDE.md §2: ningún error de guardado de dato financiero puede
// fallar en silencio).
export function parseImporteManual(raw: string): ParseImporteManualResult {
  if (raw === "") return { ok: true, value: null };
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/dashboard/parse-importe-manual.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/parse-importe-manual.ts lib/dashboard/parse-importe-manual.test.ts
git commit -m "feat(dashboard): agrega parseImporteManual, rechaza input numérico inválido en vez de silenciarlo a null"
```

---

### Task 2: Aplicar el fix en `compras-detalle-modal.tsx`

**Files:**
- Modify: `components/dashboard/compras-detalle-modal.tsx:1-32` (import) y `:490-524` (`guardarConfirmado`)

**Interfaces:**
- Consumes: `parseImporteManual` (Task 1)

- [ ] **Step 1: Agregar el import**

En `components/dashboard/compras-detalle-modal.tsx`, agregar junto a los imports existentes de `@/lib/dashboard/*` (línea 21-22):

```ts
import { parseImporteManual } from "@/lib/dashboard/parse-importe-manual";
```

- [ ] **Step 2: Aplicar el fix en `guardarConfirmado`**

Reemplazar el inicio de la función (líneas 490-504, desde `const guardarConfirmado = useCallback(async (state: EditState) => {` hasta el cierre de `requestBody`) por:

```ts
  const guardarConfirmado = useCallback(async (state: EditState) => {
    // En una compra distribuida el importe se reparte por regla — no se
    // manda importeManual para no pisar la compra base con la fracción de
    // un destino (el input queda bloqueado en el formulario), así que no
    // hace falta validarlo en ese caso.
    let importeManual: number | null = null;
    if (!state.esDistribuida) {
      const importeResult = parseImporteManual(state.importeManual);
      if (!importeResult.ok) {
        setSaveError("El importe ingresado no es un número válido.");
        return;
      }
      importeManual = importeResult.value;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const requestBody = {
        ...(state.esDistribuida ? {} : { importeManual }),
        fechaManual:          state.fechaManual !== "" ? new Date(state.fechaManual + "T12:00:00Z").toISOString() : null,
        conceptoCodigoManual: state.conceptoCodigoManual !== "" ? state.conceptoCodigoManual : null,
        observacManual:       state.observacManual !== "" ? state.observacManual : null,
      };
```

El resto de la función (desde `const res = await fetch(...)` en adelante) queda exactamente igual, sin cambios.

- [ ] **Step 3: Verificar tipos y build**

Run: `npm run lint`
Expected: sin errores nuevos.

Run: `npx tsc --noEmit`
Expected: sin errores de tipos.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/compras-detalle-modal.tsx
git commit -m "fix(dashboard): compras-detalle-modal rechaza importe inválido en vez de borrar el override en silencio"
```

---

### Task 3: Aplicar el fix en `ventas-detalle-modal.tsx`

**Files:**
- Modify: `components/dashboard/ventas-detalle-modal.tsx:1-14` (import) y `:141-163` (`handleSave`)

**Interfaces:**
- Consumes: `parseImporteManual` (Task 1)

- [ ] **Step 1: Agregar el import**

En `components/dashboard/ventas-detalle-modal.tsx`, agregar junto al import existente de `@/lib/dashboard/params` (línea 9):

```ts
import { parseImporteManual } from "@/lib/dashboard/parse-importe-manual";
```

- [ ] **Step 2: Aplicar el fix en `handleSave`**

Reemplazar la función completa (líneas 141-163) por:

```ts
  const handleSave = useCallback(async (state: EditState) => {
    const importeResult = parseImporteManual(state.importeManual);
    if (!importeResult.ok) {
      setSaveError("El importe ingresado no es un número válido.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/dashboard/ventas/${state.rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importeManual: importeResult.value,
        }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      await Promise.all([
        queryClient.refetchQueries({ queryKey }),
        queryClient.refetchQueries({ queryKey: ["pivot-ventas"] }),
      ]);
      setEditing(null);
    } catch {
      setSaveError("No se pudo guardar. Intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }, [queryClient, queryKey]);
```

- [ ] **Step 3: Verificar tipos y build**

Run: `npm run lint`
Expected: sin errores nuevos.

Run: `npx tsc --noEmit`
Expected: sin errores de tipos.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/ventas-detalle-modal.tsx
git commit -m "fix(dashboard): ventas-detalle-modal rechaza importe inválido en vez de borrar el override en silencio"
```

---

### Task 4: `ventas/[rowId]/route.ts` — loguear errores no esperados del PATCH

**Files:**
- Modify: `app/api/dashboard/ventas/[rowId]/route.ts:38-43`

- [ ] **Step 1: Aplicar el fix**

Reemplazar el bloque catch (líneas 38-43):

```ts
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
```

por:

```ts
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    }
    console.error("[PATCH /api/dashboard/ventas/[rowId]]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
```

(mismo patrón que ya usa el sibling `app/api/dashboard/compras/[rowId]/route.ts:75` — este era el único de los dos que no lo tenía).

- [ ] **Step 2: Verificar build**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add app/api/dashboard/ventas/\[rowId\]/route.ts
git commit -m "fix(dashboard): ventas PATCH loguea errores no esperados en vez de tragarlos en silencio"
```

---

### Task 5: Cascada de apertura tras DELETE de regla — reportar fallo total y mostrarlo en la UI

**Files:**
- Modify: `app/api/apertura/reglas/[id]/route.ts:193-202` (DELETE)
- Modify: `components/dashboard/apertura-gastos-modal.tsx:343-357` (`handleEliminar`)

**Interfaces:**
- Consumes: `notify.aperturaSincronizacionConErrores` (`lib/toast.ts`, ya existe — mismo toast que usa el flujo de import cuando la cascada de reglas falla parcialmente tras un reimport, reutilizado acá en vez de crear un mensaje nuevo).

- [ ] **Step 1: Backend — que el catch de la cascada deje `erroresCascada` no vacío**

En `app/api/apertura/reglas/[id]/route.ts`, reemplazar el bloque (líneas 193-202):

```ts
    let erroresCascada: string[] = [];
    try {
      const resultado = await reaplicarReglasActivas(prisma);
      erroresCascada = resultado.errores;
      if (erroresCascada.length > 0) {
        console.error("[DELETE /api/apertura/reglas/[id]] errores en la cascada de reaplicación", erroresCascada);
      }
    } catch (err) {
      console.error("[DELETE /api/apertura/reglas/[id]] la cascada de reaplicación falló por completo (la regla ya se eliminó)", err);
    }
```

por:

```ts
    let erroresCascada: string[] = [];
    try {
      const resultado = await reaplicarReglasActivas(prisma);
      erroresCascada = resultado.errores;
      if (erroresCascada.length > 0) {
        console.error("[DELETE /api/apertura/reglas/[id]] errores en la cascada de reaplicación", erroresCascada);
      }
    } catch (err) {
      console.error("[DELETE /api/apertura/reglas/[id]] la cascada de reaplicación falló por completo (la regla ya se eliminó)", err);
      // Antes acá erroresCascada quedaba en [] — la respuesta al cliente era
      // indistinguible de "cascada corrió limpia, 0 errores" cuando en
      // realidad no se reaplicó ninguna regla. Ver hallazgo de code-review.
      erroresCascada = [
        "La cascada de reaplicación de reglas falló por completo tras eliminar esta regla — revisar manualmente qué compras quedaron sin redistribuir.",
      ];
    }
```

- [ ] **Step 2: Frontend — leer `erroresCascada` de la respuesta y avisar al usuario**

En `components/dashboard/apertura-gastos-modal.tsx`, reemplazar `handleEliminar` (líneas 343-357):

```ts
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
      notify.errorActualizar(entidadNombre);
    } finally {
      setEliminando(false);
    }
  }
```

por:

```ts
  async function handleEliminar() {
    if (!reglaAEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/apertura/reglas/${reglaAEliminar.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      const payload = await res.json().catch(() => null);
      const erroresCascada = payload?.erroresCascada as string[] | undefined;
      await refetchDependientes();
      if (erroresCascada && erroresCascada.length > 0) {
        notify.aperturaSincronizacionConErrores(erroresCascada.length);
      } else {
        notify.registroActualizado();
      }
      setReglaAEliminar(null);
    } catch {
      notify.errorActualizar(entidadNombre);
    } finally {
      setEliminando(false);
    }
  }
```

- [ ] **Step 3: Verificar tipos y build**

Run: `npm run lint`
Expected: sin errores nuevos.

Run: `npx tsc --noEmit`
Expected: sin errores de tipos.

- [ ] **Step 4: Commit**

```bash
git add app/api/apertura/reglas/\[id\]/route.ts components/dashboard/apertura-gastos-modal.tsx
git commit -m "fix(apertura): DELETE de regla reporta y muestra si la cascada de reaplicación falló por completo"
```

---

### Task 6: Verificación final

**Files:** ninguno (solo corridas de verificación)

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS, incluidos los 6 tests nuevos de `parseImporteManual`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Nota de verificación manual pendiente**

Este proyecto no tiene infraestructura de testing de componentes React ni de route handlers (sin `@testing-library/react`, sin tests bajo `app/api/**`, confirmado antes de escribir este plan) — los cambios en `compras-detalle-modal.tsx`, `ventas-detalle-modal.tsx` y `apertura-gastos-modal.tsx` quedan verificados por tipos/lint/build, pero NO por un test automatizado que ejercite la UI real. Antes de dar Task 2, 3 y 5 por completamente cerradas, alguien con acceso al dashboard corriendo debería:
  - Editar una compra/venta con `importeManual` y confirmar que un valor inválido (ej. borrar todo y dejar solo `-`) muestra el error en vez de guardar.
  - Confirmar que un valor válido sigue guardando normalmente (no regresión).
  - (Opcional, requiere forzar el escenario) confirmar que al eliminar una regla de apertura se ve el toast de "sincronización con errores" si la cascada falla.

Si Task 5's implementer tiene acceso a un browser real (Playwright MCP u otra herramienta), correr esta verificación directamente en vez de dejarla como nota. Si no, decirlo explícitamente en el reporte final en vez de asumir que compila = funciona.

- [ ] **Step 5: Commit final si Steps 1-3 requirieron algún ajuste**

Si todo pasó en verde sin cambios, no hay nada que commitear en este task.

---

## Fuera de alcance (deliberado)

- `scripts/reset-db.ts` (no chequea cascada de `distribucionApertura` antes de borrar compras, no borra `ReglaApertura`/`DestinoRegla`, 9 `deleteMany` secuenciales sin transacción) — plan aparte, con brainstorming previo, por ser un cambio de contrato en una herramienta destructiva.
- `scripts/cleanup-duplicados-compras.ts` (`claveGrupo` sin `localId`) — riesgo bajo, script ya acotado a un incidente histórico con causa raíz cortada y fuertemente reforzado con transacciones/recálculo en vivo desde el review original. No se toca en este plan.
- El handler de guardar/editar una regla de apertura (`handleGuardar` en `apertura-gastos-modal.tsx`, PATCH) también recibe `comprasAfectadas` pero no `erroresCascada` de la respuesta del PATCH — mismo patrón que el DELETE, pero no estaba en la lista de hallazgos original; queda anotado acá para un futuro pase, no incluido en este plan para no expandir el alcance.
