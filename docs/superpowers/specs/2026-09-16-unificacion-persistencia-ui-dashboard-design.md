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
- Generalice la técnica de script bloqueante del tema a los campos "chrome" que necesitan cero parpadeo (tema y filtros vía un único script en `<head>`; el sidebar vía un mecanismo dedicado que reutiliza los atributos propios de shadcn — ver Arquitectura, punto 3, con la justificación técnica de por qué no puede compartir el script de `<head>`).
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

### 2. Generador único de script bootstrap para campos "chrome" de nivel `<html>`

Nuevo módulo `lib/ui-persistence/bootstrap-script.ts`:

```ts
type ChromeFieldConfig = {
  storageKey: string;       // clave de localStorage
  statePath?: string;       // ej: "state.showFilters" si storageKey guarda un blob JSON (zustand persist)
  htmlAttr: string;         // ej: "data-filters-open"
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
  { storageKey: "dashboard:state", statePath: "state.showFilters", htmlAttr: "data-filters-open", serialize: v => String(v !== false), defaultAttrValue: "true" },
]);
```

Reemplaza el `<script dangerouslySetInnerHTML>` hardcodeado actual (que solo cubre tema) por este generado, en el mismo lugar y mismo momento de ejecución. **El sidebar queda fuera de este script** — ver punto 3, tiene un mecanismo dedicado por razones técnicas concretas.

### 3. Mecanismo dedicado para el sidebar (no pasa por `<html>` + CSS override)

Investigación concreta (leyendo `components/ui/sidebar.tsx`): el colapso visual del sidebar no es un solo elemento — son **13 selectores Tailwind distintos** (`group-data-[collapsible=icon]:...`) repartidos en el primitivo de shadcn (ancho del gap, ancho del container, ocultar labels de grupo, ocultar badges, ocultar submenús, padding de botones, etc.), todos leyendo el atributo `data-collapsible` de un div que shadcn gestiona internamente (`data-slot="sidebar"`). Un override CSS genérico (`html[data-sidebar-state=...] [data-slot=...]`) obligaría a duplicar los 13 selectores a mano y mantenerlos sincronizados para siempre con un componente de terceros — fragil y, si queda incompleto, visualmente peor que el flash actual (ej: ancho correcto pero texto sin ocultar).

En cambio, el sidebar reutiliza el **mismo contrato de atributos que shadcn ya usa** (`data-state`, `data-collapsible`), evitando duplicar nada de su CSS:

- `SidebarProvider` (`components/ui/sidebar.tsx`) cambia su estado interno de `useState(defaultOpen)` a un lazy initializer que lee `localStorage` sincrónicamente en el primer render del cliente:
  ```ts
  const [_open, _setOpen] = React.useState(() => {
    if (typeof window === "undefined") return defaultOpen;
    try {
      const raw = JSON.parse(localStorage.getItem("dashboard:state") ?? "{}");
      return typeof raw?.state?.sidebarOpen === "boolean" ? raw.state.sidebarOpen : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });
  ```
  En servidor, `window` no existe → usa `defaultOpen` (coincide con el HTML que manda el servidor). En el primer render del cliente (durante la hidratación), ya lee el valor real — no hace falta ningún efecto posterior ni "seed" en dos fases.
- El div que shadcn marca con `data-slot="sidebar"` (línea ~211) gana `suppressHydrationWarning` — la misma técnica que ya usa `app/layout.tsx` para el `<html>` del tema: le dice a React "no compares ni corrijas este atributo puntual contra lo que mandó el servidor", porque sabemos que difiere a propósito.
- Falta cubrir la ventana **antes** de que cargue el JS (el HTML crudo del servidor, con el sidebar expandido por default, es visible apenas el browser parsea el HTML — antes de que React exista). Para eso, un script inline se coloca en `app/(shell)/layout.tsx` **inmediatamente después del `<AppSidebar>` renderizado por el servidor** (no en `<head>`, porque ese div todavía no existe cuando el `<head>` se ejecuta): busca el nodo `[data-slot="sidebar"]` ya presente en el HTML y le setea `data-state`/`data-collapsible` con el mismo criterio que el lazy initializer de arriba, antes de que el browser pinte. Al ser un script síncrono y bloqueante, corre antes de que el navegador presente ese frame.

Con esto, el 100% del CSS existente de shadcn (`group-data-[collapsible=icon]:...`) sigue funcionando sin tocarlo ni duplicar un solo selector.

### 4. Hook compartido para el resto de los campos "chrome" (`showFilters`)

Nuevo hook `usePersistedChromeField<T>(key, defaultValue)` en `hooks/use-persisted-chrome-field.ts`, con el mismo lazy-initializer del punto 3 (lee `localStorage` sincrónicamente en el primer render del cliente, default en servidor) generalizado a cualquier campo del store. Reemplaza el patrón seed-then-handoff de dos fases que usa hoy `components/dashboard/dashboard-content.tsx` (ya no hace falta: al no depender de una prop SSR, no hay dos fases, el valor correcto está disponible desde el primer render de cliente).

El elemento cuyo estilo depende de este valor (el `motion.div` del panel de filtros) también gana `suppressHydrationWarning`, y `app/globals.css` gana una única regla de CSS para tapar la ventana pre-JS (generada por el script del punto 2, vía `data-filters-open` en `<html>`):

```css
html[data-filters-open="false"] [data-slot="dashboard-filters-panel"] { height: 0; opacity: 0; overflow: hidden; }
```

A diferencia del sidebar, acá **sí** alcanza con una sola regla porque es un único elemento propio de esta app (no un árbol de selectores de un primitivo de terceros).

El setter que expone el hook actualiza el store de zustand (que persiste solo vía `PERSISTED_FIELD_KEYS`) — no hace falta escribir el atributo del DOM manualmente en cada set, porque una vez hidratado, React ya controla ese elemento de punta a punta (el atributo `data-filters-open` en `<html>` solo importaba para la ventana pre-JS, no para interacciones posteriores).

## Retiro de mecanismos viejos

- Se borra `lib/dashboard/filters-cookie.ts` completo.
- `app/(shell)/dashboard/page.tsx` deja de leer cookies; vuelve a ser un Server Component simple sin `cookies()`.
- `components/dashboard/dashboard-content.tsx` deja de recibir `defaultOpen` como prop; usa el hook del punto 4 directamente.
- `components/ui/sidebar.tsx`: se elimina el `document.cookie` write ligado a `SIDEBAR_COOKIE_NAME` (línea 85 hoy) — ya no hace falta, el lazy initializer + script inline del punto 3 reemplazan por completo ese mecanismo. `SIDEBAR_COOKIE_NAME` y `SIDEBAR_COOKIE_MAX_AGE` se borran.
- `app/(shell)/layout.tsx`: `SidebarProvider` pasa a modo controlado (`open`/`onOpenChange` desde `useDashboardStore`) en vez de uncontrolled con `useState` interno; se agrega el script inline del punto 3 justo después de `<AppSidebar>`.

## Grupo "datos" (sin cambio de comportamiento)

`year`, `tab`, `sortCol`, `sortDir`, `agrupacionCompras`, `localId`, `pdvId` siguen exactamente igual que hoy: `skipHydration: true` + `useDashboardStore.persist.rehydrate()` en un `useEffect` (ya existe, no se toca), con el flash aceptado explícitamente por el usuario. El único cambio es que ahora persisten vía el `PERSISTED_FIELD_KEYS` declarativo en vez de un `partialize` mantenido a mano.

## Manejo de errores

- Toda lectura de `localStorage` dentro del script bootstrap y del hook usa `try/catch` con un default explícito ante `JSON.parse` inválido, storage bloqueado (modo privado) o clave ausente — nunca un catch vacío silencioso.
- Si `localStorage` no está disponible (SSR, o navegador con storage deshabilitado), el bootstrap script y el hook caen al default sin excepción no controlada.

## Testing

- Unit tests (vitest) para `buildBootstrapScript`: dado un manifiesto, genera el script esperado; casos límite (JSON corrupto, clave ausente, `statePath` que no existe) caen al default sin explotar.
- Unit tests para el `partialize` derivado de `PERSISTED_FIELD_KEYS`: agregar una key nueva a la constante alcanza para que se persista (test de regresión directo del bug ya ocurrido con `agrupacionCompras`).
- Unit tests para el lazy initializer de `SidebarProvider` y para `usePersistedChromeField`: dado un `localStorage` con valor guardado, JSON corrupto, o vacío, devuelven el valor esperado o el default — aislables sin DOM real (mock de `window`/`localStorage`).
- Verificación manual en browser (responsabilidad del usuario, sin acceso a browser en este entorno): reload con sidebar colapsado, con filtros ocultos, y con tema oscuro — sin parpadeo en ninguno de los tres casos, individualmente y combinados; además, togglear cada uno después de cargada la página y confirmar que la animación/transición sigue funcionando con normalidad (no debe quedar "pisada" por ningún resabio del mecanismo pre-hidratación).
- `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` antes de cerrar cualquier tarea del plan derivado.

## Riesgos conocidos

- El script inline que corrige los atributos del sidebar debe ejecutarse después de que ese nodo específico exista en el HTML pero antes de que el navegador lo pinte — el plan debe incluir una tarea de verificación manual explícita de que no hay ningún frame intermedio visible (probado con CPU throttling en devtools, ya que en localhost la carga es demasiado rápida para notar un flash a ojo).
- Cambiar `SidebarProvider` a modo controlado es un cambio de comportamiento sobre un primitivo de terceros (shadcn) — debe revisarse que no rompa el atajo de teclado (`Cmd/Ctrl+B`) ni el comportamiento en mobile (`openMobile`, que no se toca y sigue uncontrolled).
- `suppressHydrationWarning` oculta advertencias legítimas de mismatch en ese nodo puntual — si en el futuro alguien agrega al mismo div otro atributo que sí deba coincidir entre servidor y cliente, esa discrepancia real quedaría silenciada también. Mitigación: comentario en el código señalando exactamente qué atributos son intencionalmente divergentes.
