# Unificación del mecanismo de persistencia de estado de UI (dashboard)

## Contexto

Hoy coexisten tres mecanismos distintos de persistencia de estado de UI:

1. **Cookie + SSR** (`lib/dashboard/filters-cookie.ts`, leída en `app/(shell)/dashboard/page.tsx`, pasada como `defaultOpen` a `DashboardContent`) — usada solo para `showFilters`. Cero parpadeo, pero con un antecedente sin causa raíz confirmada cuando se intentó el mismo patrón para el sidebar (sesión anterior, descartado a pedido del usuario).
2. **Zustand + localStorage con `skipHydration: true`** (`hooks/use-dashboard-store.ts`) — usada para `stored` (meses), `sortCol`, `sortDir`, `year`, `tab`, `localId`, `pdvId`, `agrupacionCompras`. Parpadeo aceptado (breve refetch con valor por defecto antes de asentar el valor persistido). El `partialize` es un objeto mantenido a mano, lo que causó un bug real: `agrupacionCompras` se agregó al store pero no a `partialize`, así que nunca persistía (fix aplicado en el commit `fed696b`, sin cambio de arquitectura).
3. **Script síncrono bloqueante en `<head>`** (`app/layout.tsx`) — usado solo para tema claro/oscuro, manipulando `document.documentElement.classList` antes de que React monte. Cero parpadeo.
4. **Cookie propia de shadcn** (`components/ui/sidebar.tsx`, `SIDEBAR_COOKIE_NAME`) — mecanismo de persistencia del sidebar que trae el primitivo de UI, hoy sin uso real coordinado con el resto de la app (el sidebar no persiste su estado de forma confiable — bug reportado y no resuelto).

El usuario pidió explícitamente evitar que convivan varios métodos distintos y consolidar todo bajo un único mecanismo modular, reutilizable y DRY.

## Objetivo

Un solo patrón de persistencia de estado de UI para el dashboard, que:
- Elimine la cookie y el SSR-read de `showFilters`.
- Resuelva de forma definitiva la persistencia del sidebar (colapsado/expandido).
- Generalice la técnica de script bloqueante del tema a cualquier campo "chrome" que necesite cero parpadeo (tema, sidebar, filtros).
- Haga estructuralmente imposible el bug de "campo persistido a medias" que ya ocurrió con `agrupacionCompras`.
- No introduzca dependencias nuevas ni un segundo mecanismo de estado (Context API crudo) — todo sobre zustand, que ya es el mecanismo aprobado en el stack (CLAUDE.md sección 8) para estado de UI/cliente.

## Alcance

**Incluye:**
- `showFilters` (panel de filtros del dashboard)
- `sidebarOpen` (colapsado/expandido del sidebar de la app)
- tema claro/oscuro
- `agrupacionCompras`, `year`, `tab`, `localId`, `pdvId`, `sortCol`, `sortDir` (grupo "datos", sin cambio de comportamiento, solo de mecanismo interno)

**No incluye (fuera de alcance, explícitamente):**
- Cero parpadeo para el grupo "datos" — el usuario confirmó que el flash breve actual (refetch con valor por defecto antes de asentar el persistido) es aceptable y no se va a resolver acá; hacerlo requeriría SSR data-fetching parametrizado, un cambio mucho más grande y de mayor riesgo, no solicitado.
- Cualquier cambio a las reglas de negocio de apertura/prorrateo por proveedor.
- Modo `offcanvas` del sidebar (la app usa `collapsible="icon"` exclusivamente, no se toca).

## Arquitectura

### 1. Store único con lista declarativa de campos persistidos

`hooks/use-dashboard-store.ts` gana dos campos nuevos al store existente:
- `sidebarOpen: boolean` (default `true`)
- `showFilters` deja de sincronizarse por cookie; pasa a ser un campo persistido normal del store (ya existe como campo del store hoy, solo cambia cómo se persiste).

El `partialize` deja de ser un objeto escrito a mano. Se declara una constante única:

```ts
const PERSISTED_FIELD_KEYS = [
  "stored", "sortCol", "sortDir", "year", "tab", "localId", "pdvId",
  "agrupacionCompras", "showFilters", "sidebarOpen",
] as const;
```

y `partialize: (s) => pick(s, PERSISTED_FIELD_KEYS)`, usando un helper `pick` genérico (puede vivir en `lib/dashboard/pick.ts` o inline si es trivial). Cualquier campo nuevo que deba persistir se agrega a este array — un solo lugar, no dos.

El tema **no** se mueve a este store: es un concern app-wide (afecta todo `app/layout.tsx`, no solo `/dashboard`), mientras que `useDashboardStore` es conceptualmente dashboard-scoped. Meterlo ahí violaría SRP. Se mantiene como pieza independiente (ver punto 2), construida con la misma utilidad genérica.

### 2. Generador único de script bootstrap para campos "chrome"

Nuevo módulo `lib/ui-persistence/bootstrap-script.ts`:

```ts
type ChromeFieldConfig = {
  storageKey: string;       // clave de localStorage
  statePath?: string;       // ej: "state.sidebarOpen" si storageKey guarda un blob JSON (zustand persist)
  htmlAttr: string;         // ej: "data-sidebar-state"
  serialize: (rawValue: unknown) => string; // mapea el valor leído al string del atributo
  defaultAttrValue: string; // valor a usar si no hay nada en storage o el parseo falla
};

export function buildBootstrapScript(fields: ChromeFieldConfig[]): string;
```

La función genera un único string de IIFE que, para cada `ChromeFieldConfig`, hace `try { ...leer y parsear... } catch { usar default }` (nunca un catch vacío silencioso — ver CLAUDE.md sección 2: ante fallo de parseo cae a un default explícito, no se traga el error sin criterio) y aplica el atributo/clase correspondiente sobre `document.documentElement` antes del primer paint.

`app/layout.tsx` pasa a usar:

```ts
const bootstrapScript = buildBootstrapScript([
  { storageKey: "theme", htmlAttr: "class", serialize: v => v === "dark" ? "dark" : "", defaultAttrValue: "" },
  { storageKey: "dashboard:state", statePath: "state.sidebarOpen", htmlAttr: "data-sidebar-state", serialize: v => v === false ? "collapsed" : "expanded", defaultAttrValue: "expanded" },
  { storageKey: "dashboard:state", statePath: "state.showFilters", htmlAttr: "data-filters-open", serialize: v => String(v !== false), defaultAttrValue: "true" },
]);
```

Reemplaza el `<script dangerouslySetInnerHTML>` hardcodeado actual (que solo cubre tema) por este generado, en el mismo lugar y mismo momento de ejecución.

### 3. Hook compartido para handoff de campos chrome

Nuevo hook `usePersistedChromeField<T>(selector, setter)` en `hooks/use-persisted-chrome-field.ts`, que reemplaza:
- el patrón seed-then-handoff manual de `components/dashboard/dashboard-content.tsx` (hoy atado a la prop `defaultOpen` que venía de SSR/cookie),
- la lógica que se hubiera necesitado para el sidebar (diseñada en la sesión anterior y descartada antes de mergear).

Comportamiento: en el primer render de cliente, lee el mismo storage que ya leyó el script bootstrap (mismo `storageKey`/`statePath`) para arrancar de acuerdo con lo que el CSS pre-paint ya mostró — nunca hay desacuerdo entre el primer pintado y el primer render de React. Expone un setter que actualiza el store de zustand (que persiste solo) y, en el mismo tick, actualiza el atributo del DOM correspondiente — así una interacción del usuario después de hidratar seguir siendo instantánea y coherente con el CSS.

`components/dashboard/dashboard-content.tsx` y el sidebar (`app/(shell)/layout.tsx`, pasando a `SidebarProvider` controlado) usan este mismo hook — una sola implementación para los dos casos, no dos variantes ad hoc.

### 4. CSS de override

`app/globals.css` gana las reglas (generalizando la que ya existía en el intento descartado de sidebar):

```css
html[data-sidebar-state="collapsed"] [data-slot="sidebar-..."] { /* ... */ !important; }
html[data-filters-open="false"] [data-slot="dashboard-filters-panel"] { height: 0; opacity: 0; overflow: hidden; }
```

Estas reglas solo importan para el instante entre el primer paint y el momento en que React/framer-motion toman control (el hook del punto 3 asegura que ambos arranquen de acuerdo, así que no hay pelea de estilos ni animación espuria al cargar).

## Retiro de mecanismos viejos

- Se borra `lib/dashboard/filters-cookie.ts` completo.
- `app/(shell)/dashboard/page.tsx` deja de leer cookies; vuelve a ser un Server Component simple sin `cookies()`.
- `components/dashboard/dashboard-content.tsx` deja de recibir `defaultOpen` como prop; usa el hook del punto 3 directamente.
- `components/ui/sidebar.tsx`: se elimina el `document.cookie` write ligado a `SIDEBAR_COOKIE_NAME` (mecanismo propio de shadcn, no coordinado con el resto de la app).
- `app/(shell)/layout.tsx`: `SidebarProvider` pasa a modo controlado (`open`/`onOpenChange` desde el store vía el hook del punto 3) en vez de uncontrolled con `useState` interno.

## Grupo "datos" (sin cambio de comportamiento)

`year`, `tab`, `sortCol`, `sortDir`, `agrupacionCompras`, `localId`, `pdvId` siguen exactamente igual que hoy: `skipHydration: true` + `useDashboardStore.persist.rehydrate()` en un `useEffect` (ya existe, no se toca), con el flash aceptado explícitamente por el usuario. El único cambio es que ahora persisten vía el `PERSISTED_FIELD_KEYS` declarativo en vez de un `partialize` mantenido a mano.

## Manejo de errores

- Toda lectura de `localStorage` dentro del script bootstrap y del hook usa `try/catch` con un default explícito ante `JSON.parse` inválido, storage bloqueado (modo privado) o clave ausente — nunca un catch vacío silencioso.
- Si `localStorage` no está disponible (SSR, o navegador con storage deshabilitado), el bootstrap script y el hook caen al default sin excepción no controlada.

## Testing

- Unit tests (vitest) para `buildBootstrapScript`: dado un manifiesto, genera el script esperado; casos límite (JSON corrupto, clave ausente, `statePath` que no existe) caen al default sin explotar.
- Unit tests para el `partialize` derivado de `PERSISTED_FIELD_KEYS`: agregar una key nueva a la constante alcanza para que se persista (test de regresión directo del bug ya ocurrido con `agrupacionCompras`).
- Unit tests para `usePersistedChromeField` (si es testeable de forma aislada; si no, se cubre por los tests de integración de los componentes que lo usan).
- Verificación manual en browser (responsabilidad del usuario, sin acceso a browser en este entorno): reload con sidebar colapsado, con filtros ocultos, y con tema oscuro — sin parpadeo en ninguno de los tres casos, individualmente y combinados.
- `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` antes de cerrar cualquier tarea del plan derivado.

## Riesgos conocidos

- La interacción entre el override CSS y las animaciones de framer-motion (sidebar y filtros) es la parte más delicada del diseño — ya se navegó una vez en la sesión anterior para el caso del sidebar aisladamente; acá se generaliza a dos campos a la vez. El plan de implementación debe incluir una tarea específica de verificación manual de este punto antes de dar la migración por cerrada.
- Cambiar `SidebarProvider` a modo controlado es un cambio de comportamiento sobre un primitivo de terceros (shadcn) — debe revisarse que no rompa combinaciones de teclado/gestos que el primitivo maneja internamente en modo uncontrolled.
