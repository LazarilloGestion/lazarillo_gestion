# Seguridad — lazarillo-gestion

## RLS de Supabase no aplica con esta arquitectura

El proyecto usa Supabase solo para autenticación (Google OAuth + sesión de usuario). Los datos de negocio (compras, ventas, proveedores, artículos, etc.) viven en el mismo Postgres pero se acceden **exclusivamente vía Prisma**, con una conexión directa a la base:

- `lib/prisma.ts` conecta con `@prisma/adapter-pg` usando `DATABASE_URL` — nunca pasa por PostgREST, que es la capa donde Supabase aplica Row Level Security.
- `lib/supabase/admin.ts` (`getSupabaseAdmin()`) usa `SUPABASE_SERVICE_ROLE_KEY` para las tablas propias de Supabase (`user_drive_config`, Storage) — el service role bypassa RLS por diseño, con o sin políticas definidas.

**Consecuencia práctica: aunque se definan políticas RLS en Supabase, ninguna query del proyecto pasaría por ellas.** No tiene sentido invertir en escribir `CREATE POLICY` mientras esta arquitectura de conexión no cambie.

## Dónde vive la autorización, entonces

100% en capa de aplicación, en dos puntos:

1. **`proxy.ts`** (middleware): bloquea cualquier request sin sesión válida hacia una ruta no pública, y cierra sesión si el email no está en `ALLOWED_EMAILS`.
2. **`lib/auth/require-auth.ts`** (`requireAuth()` / `requireAuthUser()`): segunda capa de defensa dentro de cada API route — valida la sesión contra el servidor de Supabase Auth (detecta tokens revocados, cosa que el middleware por sí solo no garantiza en todos los casos).

### Regla operativa

**Todo route handler nuevo que lea o escriba datos de negocio debe llamar `requireAuth()` o `requireAuthUser()` como primera línea, sin excepciones.** No hay ninguna red de seguridad a nivel de base de datos que cubra un olvido acá — es la única barrera real.

Tests de regresión para esta capa: `lib/auth/require-auth.test.ts`, `lib/auth/get-user.test.ts`.

## Si en algún momento se quiere RLS real

Requeriría que al menos las operaciones sensibles dejen de pasar por Prisma directo y usen un cliente Supabase con el JWT del usuario (`createServerClient` de `@supabase/ssr`, no `getSupabaseAdmin()`), para que las queries corran con los permisos del usuario autenticado y las políticas de Postgres apliquen. Es un cambio de arquitectura, no una tarea de "agregar políticas" — evaluarlo aparte si surge una necesidad real de defensa en profundidad a nivel de base de datos.
