# Unificación de persistencia de UI (dashboard) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidar los 3 mecanismos de persistencia de estado de UI del dashboard (cookie+SSR, zustand+localStorage, script bloqueante) en un único patrón, y resolver de forma definitiva la persistencia del sidebar.

**Architecture:** Todo campo de UI persistido vive en `useDashboardStore` (zustand + localStorage), con una lista declarativa única (`PERSISTED_FIELD_KEYS`) de la que se deriva `partialize` — elimina de raíz la clase de bug donde un campo se agrega al store pero no a la persistencia. Los campos "chrome" que necesitan cero parpadeo (`showFilters`, `sidebarOpen`) se seedean sincrónicamente desde `localStorage` en el momento de crear el store (no vía el `rehydrate()` asíncrono que ya usa el grupo de "datos"), y un script bloqueante pre-paint (generado por una única función reutilizable, `buildBootstrapScript`) corrige el HTML crudo del servidor antes de que el navegador lo pinte. El sidebar, por depender de 13 selectores CSS propios de un primitivo de terceros (shadcn), reutiliza los mismos atributos que ese primitivo ya gestiona (`data-state`/`data-collapsible`) en vez de un override CSS paralelo.

**Tech Stack:** Next.js 16 (Server/Client Components), zustand (`persist` middleware), TypeScript estricto, Tailwind CSS 4, vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-unificacion-persistencia-ui-dashboard-design.md`

## Global Constraints

- No agregar dependencias nuevas (CLAUDE.md sección 7).
- `npx tsc --noEmit`, `npm run lint`, `npx vitest run` y `npm run build` deben pasar antes de cerrar cualquier tarea.
- Ningún `catch {}` vacío — toda lectura de `localStorage`/`JSON.parse` cae a un default explícito (CLAUDE.md sección 2).
- Seguir Conventional Commits en cada paso de commit (CLAUDE.md sección 6).
- La clave de storage del store zustand es literalmente `"dashboard:state"` (ya en producción, no se puede cambiar sin perder la persistencia existente de los usuarios).
- Verificación manual en browser (Task 10) queda a cargo del usuario — sin acceso a navegador en este entorno.

---

### Task 1: Helper `pick` genérico

**Files:**
- Create: `lib/pick.ts`
- Test: `lib/pick.test.ts`

**Interfaces:**
- Produces: `pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K>` — usado por Task 3 (`use-dashboard-store.ts`).

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/pick.test.ts
import { describe, expect, it } from "vitest";
import { pick } from "./pick";

describe("pick", () => {
  it("selecciona solo las keys pedidas", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("con lista vacía devuelve objeto vacío", () => {
    expect(pick({ a: 1 }, [])).toEqual({});
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/pick.test.ts`
Expected: FAIL con "Cannot find module './pick'" o similar.

- [ ] **Step 3: Implementar**

```ts
// lib/pick.ts
export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/pick.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/pick.ts lib/pick.test.ts
git commit -m "feat(lib): agrega helper genérico pick

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Helper `readPersistedField` (lectura sincrónica de localStorage)

**Files:**
- Create: `lib/dashboard/persisted-sync-read.ts`
- Test: `lib/dashboard/persisted-sync-read.test.ts`

**Interfaces:**
- Produces: `readPersistedField<T>(storageKey: string, field: string, defaultValue: T, storage?: Pick<Storage, "getItem">): T` — usado por Task 3.
- Consumes: nada de tareas anteriores.

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/dashboard/persisted-sync-read.test.ts
import { describe, expect, it } from "vitest";
import { readPersistedField } from "./persisted-sync-read";

function fakeStorage(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

describe("readPersistedField", () => {
  it("devuelve el valor persistido si existe", () => {
    const storage = fakeStorage(JSON.stringify({ state: { sidebarOpen: false } }));
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, storage)).toBe(false);
  });

  it("devuelve el default si el campo no está en el blob", () => {
    const storage = fakeStorage(JSON.stringify({ state: { otroCampo: 1 } }));
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, storage)).toBe(true);
  });

  it("devuelve el default si no hay nada guardado", () => {
    const storage = fakeStorage(null);
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, storage)).toBe(true);
  });

  it("devuelve el default si el JSON está corrupto, sin explotar", () => {
    const storage = fakeStorage("{not valid json");
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, storage)).toBe(true);
  });

  it("sin storage (undefined) devuelve el default", () => {
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/dashboard/persisted-sync-read.test.ts`
Expected: FAIL con "Cannot find module './persisted-sync-read'"

- [ ] **Step 3: Implementar**

```ts
// lib/dashboard/persisted-sync-read.ts
// Lee un campo de un blob de zustand persist ({ state: {...} }) de forma
// sincrónica, para poder seedear el valor inicial de un store SIN esperar
// a un useEffect (elimina el parpadeo de campos "chrome" como sidebarOpen
// y showFilters). El grupo de "datos" del dashboard sigue usando el
// rehydrate() asíncrono existente — acá solo se cubre el caso de cero
// parpadeo.
type StorageLike = Pick<Storage, "getItem">;

function defaultStorage(): StorageLike | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function readPersistedField<T>(
  storageKey: string,
  field: string,
  defaultValue: T,
  storage: StorageLike | undefined = defaultStorage()
): T {
  if (!storage) return defaultValue;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return defaultValue;
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    const value = parsed.state?.[field];
    return value === undefined ? defaultValue : (value as T);
  } catch {
    return defaultValue;
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/dashboard/persisted-sync-read.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/persisted-sync-read.ts lib/dashboard/persisted-sync-read.test.ts
git commit -m "feat(dashboard): agrega readPersistedField para seed sincrónico de estado chrome

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Store — `sidebarOpen`, `partialize` derivado, retiro de la cookie de filtros

**Files:**
- Modify: `hooks/use-dashboard-store.ts`

**Interfaces:**
- Consumes: `pick` (Task 1), `readPersistedField` (Task 2).
- Produces: `useDashboardStore` gana `sidebarOpen: boolean` y `setSidebarOpen: (open: boolean) => void`; nuevo selector `useSidebarPersisted(): { sidebarOpen: boolean; setSidebarOpen: (open: boolean) => void }` (usado por Task 9). `showFilters` deja de escribir la cookie.

- [ ] **Step 1: Editar imports y agregar constante de storage key**

En `hooks/use-dashboard-store.ts`, reemplazar:

```ts
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import { writeFiltersCookie } from "@/lib/dashboard/filters-cookie";
import type { SortCol, SortDir } from "@/lib/dashboard/pivot-utils";
import type { AgrupacionCompras } from "@/lib/dashboard/params";
```

por:

```ts
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import { readPersistedField } from "@/lib/dashboard/persisted-sync-read";
import { pick } from "@/lib/pick";
import type { SortCol, SortDir } from "@/lib/dashboard/pivot-utils";
import type { AgrupacionCompras } from "@/lib/dashboard/params";

const DASHBOARD_STORE_KEY = "dashboard:state";
```

- [ ] **Step 2: Agregar `sidebarOpen`/`setSidebarOpen` al tipo `DashboardStore`**

Agregar, dentro del bloque `// navigation` del tipo `DashboardStore` (después de `setAgrupacionCompras`):

```ts
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
```

- [ ] **Step 3: Cambiar el comentario y los defaults de `showFilters`/agregar `sidebarOpen` en el creator**

Reemplazar el bloque:

```ts
      // panel colapsable (persistido vía cookie, leída en SSR — ver filters-cookie.ts)
      showFilters: true,
      toggleFilters: () => {
        const next = !get().showFilters;
        writeFiltersCookie(next);
        set({ showFilters: next });
      },
      setShowFilters: (open) => set({ showFilters: open }),
    }),
```

por:

```ts
      // panel colapsable — seedeado sincrónicamente desde localStorage (ver
      // readPersistedField) para que el primer render de cliente ya arranque
      // con el valor real, sin esperar a un efecto post-mount.
      showFilters: readPersistedField(DASHBOARD_STORE_KEY, "showFilters", true),
      toggleFilters: () => set((s) => ({ showFilters: !s.showFilters })),
      setShowFilters: (open) => set({ showFilters: open }),

      // sidebar de la app (colapsado/expandido) — mismo criterio que showFilters.
      sidebarOpen: readPersistedField(DASHBOARD_STORE_KEY, "sidebarOpen", true),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
```

- [ ] **Step 4: Derivar `partialize` de una lista única**

Reemplazar:

```ts
    {
      name: "dashboard:state",
      skipHydration: true,
      partialize: (s) => ({
        stored: s.stored,
        sortCol: s.sortCol,
        sortDir: s.sortDir,
        year: s.year,
        tab: s.tab,
        localId: s.localId,
        pdvId: s.pdvId,
      }),
    }
```

por:

```ts
    {
      name: DASHBOARD_STORE_KEY,
      skipHydration: true,
      partialize: (s) => pick(s, PERSISTED_FIELD_KEYS),
    }
```

y agregar, inmediatamente antes de `const useDashboardStore = create<DashboardStore>()(`:

```ts
// Única lista de campos persistidos: agregar una key acá alcanza para que
// persista — no hay un segundo lugar que se pueda olvidar (bug real que ya
// ocurrió con agrupacionCompras, ver commit fed696b).
const PERSISTED_FIELD_KEYS = [
  "stored", "sortCol", "sortDir", "year", "tab", "localId", "pdvId",
  "agrupacionCompras", "showFilters", "sidebarOpen",
] as const satisfies readonly (keyof DashboardStore)[];

```

- [ ] **Step 5: Agregar el selector `useSidebarPersisted`**

Después de `useFiltersPanel` (justo antes de `let rehydrated = false;`), agregar:

```ts
// Selector liviano para el sidebar de la app (suscribe solo a sidebarOpen).
export function useSidebarPersisted() {
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);
  return { sidebarOpen, setSidebarOpen };
}
```

- [ ] **Step 6: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores. Si `PERSISTED_FIELD_KEYS as const satisfies readonly (keyof DashboardStore)[]` da error de tipos, ajustar a `as const` simple (sin `satisfies`) — el `satisfies` es solo para detectar typos en los nombres de campo, no crítico si la versión de TS instalada no lo soporta bien con `as const` combinado.

- [ ] **Step 7: Correr toda la suite para confirmar que nada se rompió**

Run: `npx vitest run`
Expected: PASS (todos los tests existentes, sin cambios de comportamiento del grupo de datos)

- [ ] **Step 8: Commit**

```bash
git add hooks/use-dashboard-store.ts
git commit -m "refactor(dashboard): partialize derivado de una lista única + sidebarOpen

showFilters y sidebarOpen se seedean sincrónicamente desde localStorage
en vez de vía cookie o rehydrate() asíncrono. partialize deja de ser un
objeto mantenido a mano.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `buildBootstrapScript` — generador único de script pre-paint

**Files:**
- Create: `lib/ui-persistence/bootstrap-script.ts`
- Test: `lib/ui-persistence/bootstrap-script.test.ts`

**Interfaces:**
- Produces: `buildBootstrapScript(fields: BootstrapFieldConfig[]): string`, tipo `BootstrapFieldConfig`. Usado por Task 5 (filtros) y Task 9 (sidebar).
- Consumes: nada de tareas anteriores (módulo independiente).

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/ui-persistence/bootstrap-script.test.ts
import { describe, expect, it } from "vitest";
import { buildBootstrapScript, type BootstrapFieldConfig } from "./bootstrap-script";

describe("buildBootstrapScript", () => {
  it("genera un IIFE que incluye la config serializada", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.showFilters",
        target: "documentElement",
        attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
      },
    ];
    const script = buildBootstrapScript(fields);
    expect(script).toContain("dashboard:state");
    expect(script).toContain("data-filters-open");
    expect(script.startsWith("(function(){")).toBe(true);
  });

  it("es JS válido (no explota al evaluarlo con un DOM/localStorage simulados)", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.showFilters",
        target: "documentElement",
        attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
      },
    ];
    const script = buildBootstrapScript(fields);

    const attrs: Record<string, string> = {};
    const fakeDocumentElement = {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
    };
    const fakeStorage = {
      getItem: () => JSON.stringify({ state: { showFilters: false } }),
    };
    const fn = new Function(
      "localStorage",
      "document",
      `${script}`
    );
    fn(fakeStorage, { documentElement: fakeDocumentElement, querySelector: () => null });

    expect(attrs["data-filters-open"]).toBe("false");
  });

  it("con querySelector como target, aplica los atributos al elemento encontrado", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.sidebarOpen",
        target: { querySelector: '[data-slot="sidebar"]' },
        attrs: [
          { name: "data-state", map: { false: "collapsed" }, default: "expanded" },
          { name: "data-collapsible", map: { false: "icon" }, default: "" },
        ],
      },
    ];
    const script = buildBootstrapScript(fields);

    const attrs: Record<string, string> = {};
    const fakeEl = { setAttribute: (name: string, value: string) => { attrs[name] = value; } };
    const fakeStorage = { getItem: () => JSON.stringify({ state: { sidebarOpen: false } }) };
    const fn = new Function("localStorage", "document", script);
    fn(fakeStorage, { documentElement: null, querySelector: () => fakeEl });

    expect(attrs["data-state"]).toBe("collapsed");
    expect(attrs["data-collapsible"]).toBe("icon");
  });

  it("si el storage está vacío, aplica el default sin explotar", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.showFilters",
        target: "documentElement",
        attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
      },
    ];
    const script = buildBootstrapScript(fields);
    const attrs: Record<string, string> = {};
    const fakeDocumentElement = { setAttribute: (name: string, value: string) => { attrs[name] = value; } };
    const fakeStorage = { getItem: () => null };
    const fn = new Function("localStorage", "document", script);
    fn(fakeStorage, { documentElement: fakeDocumentElement, querySelector: () => null });
    expect(attrs["data-filters-open"]).toBe("true");
  });

  it("si el JSON está corrupto, aplica el default sin explotar", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.showFilters",
        target: "documentElement",
        attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
      },
    ];
    const script = buildBootstrapScript(fields);
    const attrs: Record<string, string> = {};
    const fakeDocumentElement = { setAttribute: (name: string, value: string) => { attrs[name] = value; } };
    const fakeStorage = { getItem: () => "{not valid json" };
    const fn = new Function("localStorage", "document", script);
    expect(() => fn(fakeStorage, { documentElement: fakeDocumentElement, querySelector: () => null })).not.toThrow();
    expect(attrs["data-filters-open"]).toBe("true");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/ui-persistence/bootstrap-script.test.ts`
Expected: FAIL con "Cannot find module './bootstrap-script'"

- [ ] **Step 3: Implementar**

```ts
// lib/ui-persistence/bootstrap-script.ts
// Genera un único script síncrono para inyectar como <script
// dangerouslySetInnerHTML>, que corrige atributos del DOM ANTES del primer
// paint del navegador, leyendo un valor ya persistido en localStorage.
// Reemplaza tener un script bloqueante distinto escrito a mano por cada
// campo "chrome" (hoy solo existía uno, para el tema).
//
// Nota: el tema (dark/light) NO pasa por acá — necesita detectar
// prefers-color-scheme del sistema operativo en la primera visita, algo
// que este generador no contempla (YAGNI: es el único caso con esa regla
// extra). El tema mantiene su propio script en app/layout.tsx.
export type BootstrapAttrConfig = {
  name: string;
  // Mapea String(valorLeído) -> valor de atributo. Si no hay match, se usa `default`.
  map: Record<string, string>;
  default: string;
};

export type BootstrapFieldConfig = {
  storageKey: string;
  // Path dentro del JSON parseado, ej: "state.showFilters" (blob de zustand persist).
  // Si se omite, se usa el valor parseado tal cual.
  statePath?: string;
  target: "documentElement" | { querySelector: string };
  attrs: BootstrapAttrConfig[];
};

export function buildBootstrapScript(fields: BootstrapFieldConfig[]): string {
  const config = JSON.stringify(fields);
  return `(function(){
  var fields = ${config};
  function getPath(obj, path) {
    return path.split(".").reduce(function (acc, key) {
      return acc && typeof acc === "object" ? acc[key] : undefined;
    }, obj);
  }
  for (var i = 0; i < fields.length; i++) {
    try {
      var field = fields[i];
      var raw;
      var stored = localStorage.getItem(field.storageKey);
      if (stored) {
        var parsed = JSON.parse(stored);
        raw = field.statePath ? getPath(parsed, field.statePath) : parsed;
      }
      var el = field.target === "documentElement" ? document.documentElement : document.querySelector(field.target.querySelector);
      if (!el) continue;
      for (var j = 0; j < field.attrs.length; j++) {
        var attr = field.attrs[j];
        var key = String(raw);
        var value = Object.prototype.hasOwnProperty.call(attr.map, key) ? attr.map[key] : attr.default;
        el.setAttribute(attr.name, value);
      }
    } catch (e) {}
  }
})();`;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/ui-persistence/bootstrap-script.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ui-persistence/bootstrap-script.ts lib/ui-persistence/bootstrap-script.test.ts
git commit -m "feat(ui-persistence): agrega buildBootstrapScript, generador único de script pre-paint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Panel de filtros — retirar cookie/SSR, usar el store + bootstrap script

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/(shell)/dashboard/page.tsx`
- Modify: `components/dashboard/dashboard-content.tsx`
- Modify: `app/globals.css`
- Delete: `lib/dashboard/filters-cookie.ts`

**Interfaces:**
- Consumes: `buildBootstrapScript` (Task 4), `useFiltersPanel` (ya existe, ahora respaldado por `showFilters` seedeado sincrónicamente desde Task 3).
- Produces: `DashboardContent` deja de aceptar la prop `defaultOpen`.

- [ ] **Step 1: Agregar el script de filtros a `app/layout.tsx`**

Editar `app/layout.tsx`: agregar el import y una segunda constante de script, y un segundo `<script>` en `<head>`, dejando el script del tema intacto:

```tsx
import { buildBootstrapScript } from "@/lib/ui-persistence/bootstrap-script";
```

```tsx
const filtersBootstrapScript = buildBootstrapScript([
  {
    storageKey: "dashboard:state",
    statePath: "state.showFilters",
    target: "documentElement",
    attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
  },
]);
```

Dentro de `<head>`, después del `<script>` del tema existente:

```tsx
        <script dangerouslySetInnerHTML={{ __html: filtersBootstrapScript }} />
```

- [ ] **Step 2: Agregar el override CSS en `app/globals.css`**

Agregar, al final del archivo (después del bloque `@layer base`):

```css
/* Cero parpadeo del panel de filtros del dashboard: antes de que React
   hidrate, el script de app/layout.tsx ya dejó data-filters-open en <html>
   con el valor real de localStorage. */
html[data-filters-open="false"] [data-slot="dashboard-filters-panel"] {
  height: 0;
  opacity: 0;
  overflow: hidden;
}
```

- [ ] **Step 3: Simplificar `components/dashboard/dashboard-content.tsx`**

Reemplazar el archivo completo por:

```tsx
"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { DashboardTabContent } from "@/components/dashboard/dashboard-tab-content";
import { useFiltersPanel } from "@/hooks/use-dashboard-store";
export function DashboardContent() {
  // showFilters se seedea sincrónicamente desde localStorage en el store
  // (ver readPersistedField) — el primer render de cliente ya tiene el
  // valor real, sin fase intermedia. El override CSS en globals.css tapa
  // la ventana entre el HTML crudo del servidor y la hidratación.
  const { showFilters } = useFiltersPanel();
  const [clipping, setClipping] = useState(!showFilters);
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <div className="flex flex-col h-full p-4 md:p-6">
      <motion.div
        data-slot="dashboard-filters-panel"
        suppressHydrationWarning
        initial={false}
        animate={showFilters ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className={clipping ? "overflow-hidden" : undefined}
        onAnimationStart={() => setClipping(true)}
        onAnimationComplete={() => setClipping(!showFilters)}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white truncate">
            Panel de Gestión
          </h1>
          <p className="text-sm text-muted-foreground truncate">
            Resumen general de operaciones
          </p>
        </div>
        <div className="pt-6 pb-6">
          <DashboardFilters />
        </div>
      </motion.div>

      <div className="flex-1 min-h-0 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col">
        <DashboardTabContent isFullscreen={isFullscreen} onToggleFullscreen={() => setIsFullscreen(v => !v)} />
      </div>
    </div>
  );
}
```

Nota: `setShowFilters` ya no se usa en este componente — el toggle vive en `DashboardFiltersToggle`, que llama a `useFiltersPanel()` por su cuenta. `useFiltersPanel` (Task 3, sin cambios en su firma) sigue devolviendo los tres campos; acá simplemente se desestructura solo el que se necesita.

- [ ] **Step 4: Simplificar `app/(shell)/dashboard/page.tsx`**

Reemplazar el archivo completo por:

```tsx
import type { Metadata } from "next";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Panel de Gestión | Lazarillo Gestión",
};

export default function DashboardPage() {
  return <DashboardContent />;
}

export function FiltersSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-8 w-44" />
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div>
      <div className="bg-zinc-50 dark:bg-zinc-800 h-10 border-b border-zinc-100 dark:border-zinc-700" />
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="border-b border-zinc-100 dark:border-zinc-700/50 px-4 py-3 flex items-center gap-4">
          <Skeleton className="h-3.5 w-36" />
          <div className="flex-1 flex justify-end gap-6">
            {Array.from({ length: 5 }).map((_, j) => (
              <Skeleton key={j} className="h-3.5 w-14" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

(`DashboardPage` deja de ser `async` y de leer `cookies()` — ya no depende de nada server-only.)

- [ ] **Step 5: Borrar `lib/dashboard/filters-cookie.ts` y verificar que no queda ninguna referencia**

```bash
rm lib/dashboard/filters-cookie.ts
grep -rn "filters-cookie\|writeFiltersCookie\|FILTERS_COOKIE" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules --exclude-dir=.next
```

Expected: sin resultados (ya se quitó del store en Task 3 y de `page.tsx`/`dashboard-content.tsx` en este task).

- [ ] **Step 6: Verificar tipos, lint y tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx "app/(shell)/dashboard/page.tsx" components/dashboard/dashboard-content.tsx app/globals.css
git rm lib/dashboard/filters-cookie.ts
git commit -m "refactor(dashboard): panel de filtros pasa a persistencia unificada, retira cookie+SSR

showFilters se seedea sincrónicamente desde localStorage (Task 3) y un
script pre-paint corrige data-filters-open antes de hidratar. Elimina
el mecanismo de cookie + lectura SSR, ya redundante.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Sidebar — retirar cookie propia de shadcn, permitir seed sincrónico

**Files:**
- Modify: `components/ui/sidebar.tsx`

**Interfaces:**
- Produces: `SidebarProvider` sigue aceptando `open`/`onOpenChange` (ya existían) para uso controlado; deja de escribir su propia cookie.

- [ ] **Step 1: Quitar las constantes de cookie**

En `components/ui/sidebar.tsx`, quitar:

```ts
const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
```

- [ ] **Step 2: Quitar el `document.cookie` write dentro de `setOpen`**

Reemplazar:

```ts
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )
```

por:

```ts
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }
    },
    [setOpenProp, open]
  )
```

(La persistencia ahora la maneja quien controla el componente desde afuera — ver Task 7 — vía el store de zustand, no una cookie propia del primitivo.)

- [ ] **Step 3: Marcar `suppressHydrationWarning` en el div del sidebar de escritorio**

En la función `Sidebar`, dentro de la rama de escritorio (no mobile, no `collapsible === "none"`), el div raíz es:

```tsx
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
```

Agregar `suppressHydrationWarning` (React acepta que, cuando el componente está controlado desde afuera con un valor seedeado sincrónicamente en el cliente — Task 7 — el primer render de cliente difiera legítimamente del HTML que mandó el servidor; el mismo patrón que ya usa `<html suppressHydrationWarning>` en `app/layout.tsx` para el tema):

```tsx
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
      suppressHydrationWarning
    >
```

- [ ] **Step 4: Verificar tipos, lint y tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add components/ui/sidebar.tsx
git commit -m "refactor(ui): sidebar deja de manejar su propia cookie de persistencia

La persistencia pasa a manejarla quien controla el componente desde
afuera (useDashboardStore), no un mecanismo propio del primitivo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Wrapper controlado del sidebar + script pre-paint dedicado

**Files:**
- Create: `components/app-sidebar-provider.tsx`
- Modify: `app/(shell)/layout.tsx`

**Interfaces:**
- Consumes: `useSidebarPersisted` (Task 3), `buildBootstrapScript` (Task 4), `SidebarProvider` (Task 6).
- Produces: `AppSidebarProvider` — wrapper client-side que reemplaza el uso directo de `SidebarProvider` en el layout del shell.

- [ ] **Step 1: Crear el wrapper controlado**

```tsx
// components/app-sidebar-provider.tsx
"use client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useSidebarPersisted } from "@/hooks/use-dashboard-store";

// Conecta el SidebarProvider de shadcn (components/ui/sidebar.tsx) al store
// de zustand: sidebarOpen se seedea sincrónicamente desde localStorage
// (readPersistedField, ver hooks/use-dashboard-store.ts), así que este
// wrapper no necesita ninguna fase de "seed" propia — el valor ya es
// correcto desde el primer render de cliente.
export function AppSidebarProvider({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { sidebarOpen, setSidebarOpen } = useSidebarPersisted();
  return (
    <SidebarProvider className={className} open={sidebarOpen} onOpenChange={setSidebarOpen}>
      {children}
    </SidebarProvider>
  );
}
```

- [ ] **Step 2: Editar `app/(shell)/layout.tsx`**

Reemplazar el archivo completo por:

```tsx
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppSidebarProvider } from "@/components/app-sidebar-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { DashboardFiltersToggle } from "@/components/dashboard/dashboard-filters-toggle";
import { getAuthUser } from "@/lib/auth/get-user";
import { buildBootstrapScript } from "@/lib/ui-persistence/bootstrap-script";

// Corrige data-state/data-collapsible del sidebar ANTES de hidratar,
// reutilizando los mismos atributos que components/ui/sidebar.tsx ya
// gestiona — así el 100% del CSS existente de shadcn (group-data-[collapsible=icon]:...)
// sigue funcionando sin duplicar un solo selector. No puede ir en <head>
// como el de app/layout.tsx porque el nodo [data-slot="sidebar"] recién
// existe una vez que el <body> se parseó hasta acá.
const sidebarBootstrapScript = buildBootstrapScript([
  {
    storageKey: "dashboard:state",
    statePath: "state.sidebarOpen",
    target: { querySelector: '[data-slot="sidebar"]' },
    attrs: [
      { name: "data-state", map: { false: "collapsed" }, default: "expanded" },
      { name: "data-collapsible", map: { false: "icon" }, default: "" },
    ],
  },
]);

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  return (
    <AppSidebarProvider className="h-svh">
      <AppSidebar user={user} />
      <script dangerouslySetInnerHTML={{ __html: sidebarBootstrapScript }} />
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <header className="h-12 flex items-center px-3 border-b bg-background sticky top-0 z-30 gap-2">
          <SidebarTrigger className="h-8 w-8 shrink-0" />
          <span className="sm:hidden text-sm font-semibold tracking-tight">
            Lazarillo <span className="text-muted-foreground font-normal">Gestión</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <DashboardFiltersToggle />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-auto bg-muted/20">
          {children}
        </main>
      </div>
    </AppSidebarProvider>
  );
}
```

- [ ] **Step 3: Verificar tipos, lint y tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: todo en verde.

- [ ] **Step 4: Verificar build de producción**

Run: `npm run build`
Expected: build exitoso, sin errores de prerendering en `/dashboard` ni en el layout del shell.

- [ ] **Step 5: Commit**

```bash
git add components/app-sidebar-provider.tsx "app/(shell)/layout.tsx"
git commit -m "feat(shell): sidebar controlado por el store + script pre-paint dedicado

El colapso del sidebar persiste vía useDashboardStore (Task 3), con un
script inline que corrige data-state/data-collapsible antes de hidratar
reutilizando los atributos propios de shadcn — sin duplicar su CSS.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Verificación final de la migración completa

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: todo en verde, sin warnings nuevos.

- [ ] **Step 2: Grep de residuos**

```bash
grep -rn "SIDEBAR_COOKIE\|filters-cookie\|writeFiltersCookie\|FILTERS_COOKIE\|dash_filters\|sidebar_state" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules --exclude-dir=.next
```

Expected: sin resultados — ningún mecanismo viejo de cookie queda referenciado en el código (puede aparecer en el historial de git/docs, eso es esperable).

- [ ] **Step 3: Checklist de verificación manual (a cargo del usuario, sin browser en este entorno)**

Documentar en el mensaje de cierre de la tarea que falta, antes de dar el trabajo por cerrado:
1. Reload con sidebar colapsado → no debe verse un frame de sidebar expandido antes de asentar.
2. Reload con panel de filtros oculto → no debe verse un frame con el panel visible antes de asentar.
3. Reload con tema oscuro → sin cambios respecto a hoy (no se tocó su mecanismo).
4. Combinar los tres al mismo tiempo (sidebar colapsado + filtros ocultos + oscuro) → mismo resultado, sin parpadeo cruzado.
5. Togglear sidebar y filtros después de cargada la página → la animación/transición de cada uno debe seguir funcionando con normalidad (no debe quedar "pisada" por ningún resabio del script pre-paint).
6. Atajo de teclado `Cmd/Ctrl+B` para el sidebar sigue funcionando.
7. En mobile (`openMobile`), el sidebar sigue abriendo/cerrando con normalidad (ese estado no se tocó, sigue uncontrolled).
8. Probar con CPU throttling activado en devtools (carga más lenta = ventana pre-hidratación más larga = más fácil de notar un flash residual si lo hubiera).

- [ ] **Step 4: No hay commit en este task** — es puramente de verificación. Si el Step 3 revela un problema, volver a la tarea correspondiente, no parchear acá.
