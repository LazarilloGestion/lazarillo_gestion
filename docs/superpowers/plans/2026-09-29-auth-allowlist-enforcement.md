# Auth: Allowlist Enforcement Real en las 3 Capas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `app/auth/callback/route.ts`, `lib/auth/require-auth.ts`/`get-user.ts` y `proxy.ts` enforcen de forma independiente la invariante "solo `lazarillogestion@gmail.com` puede usar la app", en vez de que solo `proxy.ts` la chequee y las otras dos capas confíen implícitamente en que ya se aplicó.

**Architecture:** Se extrae `ALLOWED_EMAILS`/`isAllowedEmail` a un módulo puro sin dependencias de runtime (`lib/auth/allowed-emails.ts`), importable tanto desde Edge (`proxy.ts`) como desde Node (`require-auth.ts`) — se confirmó que el cliente de Supabase en sí NO se puede compartir entre ambos runtimes, así que solo se comparte el helper de la allowlist. `requireAuthUser()` pasa a ser la única fuente de verdad de autorización (sesión + email), `requireAuth()` y `getAuthUser()` delegan en ella — esto también resuelve la triplicación de código entre las 3 funciones.

**Tech Stack:** TypeScript, Next.js (middleware + route handlers), Supabase Auth (`@supabase/ssr`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-auth-allowlist-enforcement-design.md`

## Global Constraints

- La invariante es single-tenant: un único email permitido (`lazarillogestion@gmail.com`), sin sistema de roles.
- Ningún cambio debe revelar al cliente si un 401/redirect fue por "sin sesión" o por "email no permitido" — mismo mensaje genérico en ambos casos.
- No se puede compartir el cliente de Supabase entre `proxy.ts` (Edge Runtime) y `lib/auth/*` (Node runtime, usa `next/headers`) — solo se comparte el helper puro `isAllowedEmail`.
- No agregar dependencias nuevas.
- Este proyecto no tiene infraestructura de test para middleware ni route handlers (confirmado en el bloque anterior de este mismo trabajo) — `proxy.ts` y `app/auth/callback/route.ts` se verifican por tipos/lint/build, no por test automatizado.
- Correr `npm test`, `npm run lint` y `npx tsc --noEmit` al final de cada tarea.

---

### Task 1: Helper `isAllowedEmail`

**Files:**
- Create: `lib/auth/allowed-emails.ts`
- Test: `lib/auth/allowed-emails.test.ts`

**Interfaces:**
- Produces: `isAllowedEmail(email: string | null | undefined): boolean` — consumido por Task 2 (`require-auth.ts`), Task 3 (`proxy.ts`) y Task 4 (`callback/route.ts`).

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/auth/allowed-emails.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "./allowed-emails";

describe("isAllowedEmail", () => {
  it("acepta el único email permitido", () => {
    expect(isAllowedEmail("lazarillogestion@gmail.com")).toBe(true);
  });

  it("rechaza cualquier otro email", () => {
    expect(isAllowedEmail("otro@gmail.com")).toBe(false);
  });

  it("rechaza null", () => {
    expect(isAllowedEmail(null)).toBe(false);
  });

  it("rechaza undefined", () => {
    expect(isAllowedEmail(undefined)).toBe(false);
  });

  it("rechaza string vacío", () => {
    expect(isAllowedEmail("")).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/auth/allowed-emails.test.ts`
Expected: FAIL con "Cannot find module './allowed-emails'".

- [ ] **Step 3: Escribir la implementación mínima**

Crear `lib/auth/allowed-emails.ts`:

```ts
// Single-tenant: una única cuenta puede usar la app. Vive acá (sin
// dependencias de Next/Supabase) para que sea importable tanto desde
// proxy.ts (Edge Runtime) como desde lib/auth/require-auth.ts (Node
// runtime) — los clientes de Supabase de cada uno NO se pueden compartir
// entre sí, pero este helper puro sí.
const ALLOWED_EMAILS = ["lazarillogestion@gmail.com"];

export function isAllowedEmail(email: string | null | undefined): boolean {
  return ALLOWED_EMAILS.includes(email ?? "");
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/auth/allowed-emails.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/auth/allowed-emails.ts lib/auth/allowed-emails.test.ts
git commit -m "feat(auth): agrega isAllowedEmail, invariante compartida entre Edge y Node runtime"
```

---

### Task 2: `require-auth.ts` y `get-user.ts` chequean el email

**Files:**
- Modify: `lib/auth/require-auth.ts` (archivo completo)
- Modify: `lib/auth/require-auth.test.ts` (archivo completo)
- Modify: `lib/auth/get-user.ts` (archivo completo)
- Modify: `lib/auth/get-user.test.ts` (archivo completo)

**Interfaces:**
- Consumes: `isAllowedEmail` (Task 1)
- Produces: `requireAuthUser(): Promise<{user: User; response: null} | {user: null; response: NextResponse}>` — ya existía, ahora es la única fuente de verdad. `requireAuth(): Promise<NextResponse | null>` y `getAuthUser(): Promise<User | null>` — mismas firmas que ya existían, delegan en `requireAuthUser`.

- [ ] **Step 1: Escribir los tests que fallan + ajustar los existentes**

Reemplazar el contenido completo de `lib/auth/require-auth.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { requireAuth, requireAuthUser } from "./require-auth";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

function mockSupabaseUser(user: { id: string; email: string } | null, error: unknown = null) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error }) },
  });
}

describe("requireAuth", () => {
  it("devuelve null cuando hay usuario válido con email permitido", async () => {
    mockSupabaseUser({ id: "u1", email: "lazarillogestion@gmail.com" });
    expect(await requireAuth()).toBeNull();
  });

  it("devuelve 401 cuando no hay usuario", async () => {
    mockSupabaseUser(null);
    const res = await requireAuth();
    expect(res?.status).toBe(401);
  });

  it("devuelve 401 cuando supabase.auth.getUser() devuelve error (token revocado)", async () => {
    mockSupabaseUser(null, new Error("invalid token"));
    const res = await requireAuth();
    expect(res?.status).toBe(401);
  });

  it("devuelve 401 cuando hay sesión válida pero el email no está en la allowlist", async () => {
    mockSupabaseUser({ id: "u2", email: "otro@gmail.com" });
    const res = await requireAuth();
    expect(res?.status).toBe(401);
  });
});

describe("requireAuthUser", () => {
  it("devuelve { user, response: null } cuando está autenticado con email permitido", async () => {
    mockSupabaseUser({ id: "u1", email: "lazarillogestion@gmail.com" });
    const result = await requireAuthUser();
    expect(result.response).toBeNull();
    expect(result.user?.id).toBe("u1");
  });

  it("devuelve { user: null, response: 401 } cuando no está autenticado", async () => {
    mockSupabaseUser(null);
    const result = await requireAuthUser();
    expect(result.user).toBeNull();
    expect(result.response?.status).toBe(401);
  });

  it("devuelve { user: null, response: 401 } cuando el email no está en la allowlist", async () => {
    mockSupabaseUser({ id: "u2", email: "otro@gmail.com" });
    const result = await requireAuthUser();
    expect(result.user).toBeNull();
    expect(result.response?.status).toBe(401);
  });
});
```

Reemplazar el contenido completo de `lib/auth/get-user.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getAuthUser } from "./get-user";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

function mockSupabaseUser(user: { id: string; email: string } | null, error: unknown = null) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error }) },
  });
}

describe("getAuthUser", () => {
  it("devuelve el usuario cuando la sesión es válida y el email está permitido", async () => {
    mockSupabaseUser({ id: "u1", email: "lazarillogestion@gmail.com" });
    const user = await getAuthUser();
    expect(user?.id).toBe("u1");
  });

  it("devuelve null cuando no hay usuario", async () => {
    mockSupabaseUser(null);
    expect(await getAuthUser()).toBeNull();
  });

  it("devuelve null cuando supabase.auth.getUser() devuelve error", async () => {
    mockSupabaseUser(null, new Error("invalid token"));
    expect(await getAuthUser()).toBeNull();
  });

  it("devuelve null cuando el email no está en la allowlist", async () => {
    mockSupabaseUser({ id: "u2", email: "otro@gmail.com" });
    expect(await getAuthUser()).toBeNull();
  });
});
```

Nota: `createClient` sigue viniendo de `@/lib/supabase/server` en ambos tests aunque `get-user.ts` deje de llamarlo directamente (Step 3 de abajo) — el mock intercepta el módulo real que `require-auth.ts` importa por debajo, así que sigue funcionando transitivamente sin cambios en el mock.

- [ ] **Step 2: Correr los tests y verificar que los nuevos fallan**

Run: `npx vitest run lib/auth/require-auth.test.ts lib/auth/get-user.test.ts`
Expected: los tests existentes (ajustados a usar `lazarillogestion@gmail.com`) siguen en PASS — el código actual no chequea el email, así que cualquier email pasa hoy. Los 3 tests NUEVOS ("...email no está en la allowlist") FALLAN: esperan 401/`null`, pero el código actual deja pasar `otro@gmail.com` igual que cualquier otro email.

- [ ] **Step 3: Aplicar el fix en la implementación**

Reemplazar el contenido completo de `lib/auth/require-auth.ts`:

```ts
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "./allowed-emails";

/**
 * Única fuente de verdad de autorización: sesión válida Y email en la
 * allowlist (single-tenant). Mismo mensaje genérico para ambos motivos de
 * rechazo — no se distingue "sin sesión" de "email no permitido" en la
 * respuesta.
 */
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

/**
 * Segunda capa de protección para API Route Handlers (defense in depth
 * real: el middleware ya bloquea sesión inválida o email no permitido,
 * pero esto lo vuelve a validar dentro del handler — cubre el caso de un
 * request que llegue a un handler sin pasar por el middleware).
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const { response } = await requireAuthUser();
  return response;
}
```

Reemplazar el contenido completo de `lib/auth/get-user.ts`:

```ts
import type { User } from "@supabase/supabase-js";
import { requireAuthUser } from "./require-auth";

export async function getAuthUser(): Promise<User | null> {
  const { user } = await requireAuthUser();
  return user;
}
```

- [ ] **Step 4: Correr los tests y verificar que todos pasan**

Run: `npx vitest run lib/auth/require-auth.test.ts lib/auth/get-user.test.ts`
Expected: PASS (7 tests en require-auth, 4 tests en get-user)

- [ ] **Step 5: Commit**

```bash
git add lib/auth/require-auth.ts lib/auth/require-auth.test.ts lib/auth/get-user.ts lib/auth/get-user.test.ts
git commit -m "fix(auth): requireAuth/requireAuthUser/getAuthUser chequean el email, no solo la sesión"
```

---

### Task 3: `proxy.ts` — 401 JSON para `/api/*` sin sesión

**Files:**
- Modify: `proxy.ts` (archivo completo)

**Interfaces:**
- Consumes: `isAllowedEmail` (Task 1)

- [ ] **Step 1: Aplicar el fix**

Reemplazar el contenido completo de `proxy.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";
import { isAllowedEmail } from "@/lib/auth/allowed-emails";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createMiddlewareClient(request, response);

  // getUser() valida JWT contra Supabase Auth server — detecta tokens revocados
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  // Email no autorizado → cerrar sesión y redirigir
  if (user && !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }

  // Autenticado + intenta /login → redirigir al dashboard
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // No autenticado + ruta protegida:
  // - /api/*: 401 JSON — el cliente (fetch) espera JSON, no un redirect que
  //   termina devolviendo el HTML de /login con status 200.
  // - páginas: redirect a /login preservando destino.
  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    // Solo pasar pathname + search para prevenir open redirect
    const next = pathname + (searchParams.toString() ? `?${searchParams}` : "");
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  // Retornar response con cookies actualizadas (refresh token automático)
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 2: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "fix(auth): proxy.ts devuelve 401 JSON (no redirect) para /api/* sin sesión"
```

---

### Task 4: `callback/route.ts` — chequear el email antes de la escritura service-role

**Files:**
- Modify: `app/auth/callback/route.ts` (archivo completo)

**Interfaces:**
- Consumes: `isAllowedEmail` (Task 1)

- [ ] **Step 1: Aplicar el fix**

Reemplazar el contenido completo de `app/auth/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAllowedEmail } from "@/lib/auth/allowed-emails";

function isSafeRedirect(next: string): boolean {
  if (!next.startsWith("/") || next.startsWith("//")) return false;
  try {
    const url = new URL(next, "https://x");
    return url.hostname === "x";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  const safeNext = isSafeRedirect(next) ? next : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      const { session } = data;

      // Chequear el email ANTES de cualquier escritura con service-role —
      // sin esto, cualquier cuenta de Google podía completar el OAuth y
      // persistir un refresh_token real en user_drive_config antes de ser
      // rechazada recién en el siguiente request por proxy.ts.
      if (!isAllowedEmail(session.user.email)) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=unauthorized`);
      }

      // Persistir refresh token de Google para poder renovar el access token de Drive
      // provider_refresh_token solo viene en el primer consentimiento — guardarlo siempre que esté presente
      if (session.provider_refresh_token && session.user) {
        const admin = getSupabaseAdmin();
        const { error: upsertError } = await admin.from("user_drive_config").upsert(
          {
            user_id: session.user.id,
            refresh_token: session.provider_refresh_token,
          },
          { onConflict: "user_id", ignoreDuplicates: false }
        );
        if (upsertError) {
          console.error("[auth/callback] Error guardando refresh_token:", upsertError);
        }
      }

      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
```

- [ ] **Step 2: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add app/auth/callback/route.ts
git commit -m "fix(auth): callback chequea el email antes de escribir con service-role"
```

---

### Task 5: Verificación final

**Files:** ninguno (solo corridas de verificación)

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS, incluidos los tests nuevos/ajustados de Task 1 y Task 2.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Nota de verificación manual pendiente**

Mismo caso que el bloque anterior: no hay infraestructura de test para middleware ni route handlers en este proyecto. Antes de dar Task 3 y Task 4 por completamente cerradas, alguien con acceso al login real debería confirmar:
  - Loguearse con la cuenta permitida sigue funcionando normal.
  - Un `fetch()` a cualquier `/api/*` sin sesión (ej. cookies borradas) devuelve un 401 JSON, no un redirect.
  - (Si es posible probarlo) loguearse con una cuenta de Google distinta a la permitida es rechazado en el callback mismo, sin llegar a pisar `user_drive_config`.

- [ ] **Step 5: Commit final si Steps 1-3 requirieron algún ajuste**

Si todo pasó en verde sin cambios, no hay nada que commitear en este task.

---

## Fuera de alcance (deliberado)

- `lib/rate-limit.ts` (in-memory, por instancia, sin eviction) — plan separado dentro del mismo bloque.
- OAuth Drive (`prompt=consent` no fuerza re-consentimiento, refresh-token upsert failure solo logueado) — plan separado.
- Zod bypass en `pivot`/`pivot-ventas` y manejo de errores de Supabase ignorados en `drive/config` — más cercanos a Bloque 3 (DRY/validación) que a este cambio de arquitectura de auth.
