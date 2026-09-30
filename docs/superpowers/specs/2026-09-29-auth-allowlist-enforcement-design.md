# Auth: Allowlist Enforcement Real en las 3 Capas — Design

## Contexto

`lazarillo-gestion` es de un solo tenant: una única cuenta de Google
(`lazarillogestion@gmail.com`) puede usar la app. Hoy esa invariante se
enforcea en un solo lugar (`proxy.ts`, el middleware de Next), y las otras
dos capas que deberían reforzarla en realidad no la chequean:

1. **`app/auth/callback/route.ts`** — al completar el login con Google,
   persiste el `provider_refresh_token` en `user_drive_config` (con el
   cliente `service-role`, que bypassa RLS) **antes** de que exista
   ningún chequeo de email. Cualquier cuenta de Google puede completar el
   OAuth y llegar a esta escritura; recién en el *siguiente* request
   `proxy.ts` la va a rechazar y desloguear.
2. **`lib/auth/require-auth.ts`** (`requireAuth`/`requireAuthUser`) — su
   propio comentario dice "defense in depth", pero solo valida que haya
   una sesión Supabase válida. Nunca chequea el email. Si algún día un
   request llega a un handler de API sin pasar por el middleware (un
   matcher mal configurado, un rewrite interno, un cambio de Next), esta
   "segunda capa" autorizaría a cualquier cuenta de Google con sesión
   válida — no solo a la permitida.
3. **`proxy.ts`** — para rutas `/api/*` sin sesión, hace `redirect` (307)
   en vez de devolver un 401 JSON. Un `fetch()` del cliente que espera
   JSON y sigue el redirect recibe HTML de la página de login con status
   200, no un 401 — y el branch 401 de `requireAuth` nunca llega a
   ejecutarse para ese caso, quedando de código muerto.

Los 3 hallazgos vienen del mismo origen: la invariante "solo esta cuenta
puede hacer algo" vive en un solo archivo y las capas que deberían
reforzarla de forma independiente en realidad no lo hacen.

## Objetivo

Que las 3 capas (`callback`, `requireAuth`/`requireAuthUser`, `proxy.ts`)
enforcen la misma invariante de forma independiente, sin depender
implícitamente de que las otras ya la hayan aplicado.

## No-objetivos

- No se cambia el mecanismo de autenticación en sí (Supabase Auth + Google
  OAuth se mantienen igual).
- No se agrega un sistema de roles/multi-usuario — sigue siendo
  single-tenant, una sola casilla permitida.
- No se toca `@supabase/ssr` ni el manejo de cookies.
- No se resuelve acá el rate limiter (`lib/rate-limit.ts`) ni los
  problemas de OAuth Drive (`prompt=consent`) — quedan para planes
  separados del mismo bloque.

## Diseño

### 1. Invariante compartida sin dependencias de runtime

`ALLOWED_EMAILS` hoy es una constante local a `proxy.ts`. Se extrae a un
módulo nuevo:

```ts
// lib/auth/allowed-emails.ts
const ALLOWED_EMAILS = ["lazarillogestion@gmail.com"];

export function isAllowedEmail(email: string | null | undefined): boolean {
  return ALLOWED_EMAILS.includes(email ?? "");
}
```

Este módulo no importa nada de Next/Supabase — es un helper puro,
importable tanto desde `proxy.ts` (Edge Runtime) como desde
`lib/auth/require-auth.ts` (Node runtime, usa `next/headers`). Se
confirmó que **el cliente de Supabase no se puede compartir** entre
ambos (`lib/supabase/server.ts` usa `cookies()` de `next/headers`, no
disponible en Edge; `lib/supabase/middleware.ts` usa el request/response
del middleware) — por eso solo se comparte la constante/helper, no la
lógica de obtener el usuario.

### 2. `requireAuth`/`requireAuthUser`/`getAuthUser` chequean también el email

`requireAuthUser()` pasa a ser la única fuente de verdad para "¿está
autorizado?" — sesión válida Y email permitido:

```ts
export async function requireAuthUser(): Promise<
  { user: User; response: null } | { user: null; response: NextResponse }
> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user || !isAllowedEmail(user.email)) {
    return { user: null, response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  return { user, response: null };
}
```

Mismo mensaje genérico ("No autorizado") para "sin sesión" y para "sesión
válida pero email no permitido" — no se distingue el motivo en la
respuesta, para no dar pistas sobre la existencia de un allowlist.

`requireAuth()` se reimplementa como wrapper delgado de
`requireAuthUser()`:

```ts
export async function requireAuth(): Promise<NextResponse | null> {
  const { response } = await requireAuthUser();
  return response;
}
```

`getAuthUser()` (`lib/auth/get-user.ts`, usado en
`app/(shell)/layout.tsx` para pasarle el usuario al sidebar) pasa a
delegar en `requireAuthUser()` también, devolviendo `user` o `null`. Esto
cierra de paso la triplicación de código que señaló el review original
(sección 1, DRY — 3ª repetición del mismo chequeo `getUser()` +
manejo de error).

### 3. `proxy.ts`: 401 JSON para `/api/*`, redirect solo para páginas

```ts
if (!user && !isPublic) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  const next = pathname + (searchParams.toString() ? `?${searchParams}` : "");
  loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}
```

El branch de "email no autorizado" (líneas 26-29 actuales) ya hace
`signOut()` + redirect a `/login` — ese caso sigue siendo redirect
siempre (autenticado pero rechazado, no tiene sentido devolver 401 JSON
ahí porque implica que había sesión y se la mató activamente; se
mantiene igual). El cambio es específicamente para el caso "sin sesión
en absoluto contra una ruta `/api/*`".

### 4. `callback/route.ts`: chequear el email antes de la escritura service-role

```ts
if (!error && data.session) {
  const { session } = data;

  if (!isAllowedEmail(session.user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=unauthorized`);
  }

  if (session.provider_refresh_token && session.user) {
    // ... upsert con service-role, sin cambios ...
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
```

El chequeo se hace apenas se conoce `session.user.email` (inmediatamente
después de `exchangeCodeForSession`), antes de cualquier operación con el
cliente `service-role`. Cierra la ventana donde una cuenta no autorizada
llegaba a persistir un `refresh_token` real antes de ser rechazada.

## Manejo de errores

- Ningún cambio revela al cliente si el motivo del 401/redirect fue "sin
  sesión" o "email no permitido" — mismo mensaje genérico en ambos casos,
  consistente con el comportamiento actual de `proxy.ts` para el caso de
  email no autorizado.
- El callback, al rechazar por email, sigue el mismo patrón que ya usa
  `proxy.ts` (`signOut()` + redirect con `?error=unauthorized`) en vez de
  inventar un mensaje nuevo.

## Testing

- `lib/auth/allowed-emails.ts`: función pura, testeable directo con
  Vitest (email permitido, no permitido, `null`/`undefined`).
- `lib/auth/require-auth.ts`: ya existe `require-auth.test.ts` — se
  extiende con casos para email no permitido (además de los casos
  existentes de sin sesión / con sesión).
- `lib/auth/get-user.ts`: ya existe `get-user.test.ts` — se extiende
  igual.
- `proxy.ts` y `app/auth/callback/route.ts`: sin infraestructura de test
  para middleware/route handlers en este proyecto (confirmado durante el
  bloque anterior de este mismo trabajo) — verificación por
  tipos/lint/build únicamente, igual que los fixes de modales/rutas del
  bloque anterior.

## Archivos afectados

- Create: `lib/auth/allowed-emails.ts`, `lib/auth/allowed-emails.test.ts`
- Modify: `lib/auth/require-auth.ts`, `lib/auth/require-auth.test.ts`
- Modify: `lib/auth/get-user.ts`, `lib/auth/get-user.test.ts`
- Modify: `proxy.ts`
- Modify: `app/auth/callback/route.ts`
