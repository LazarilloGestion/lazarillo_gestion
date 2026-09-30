// Single-tenant: una única cuenta puede usar la app. Vive acá (sin
// dependencias de Next/Supabase) para que sea importable tanto desde
// proxy.ts (Edge Runtime) como desde lib/auth/require-auth.ts (Node
// runtime) — los clientes de Supabase de cada uno NO se pueden compartir
// entre sí, pero este helper puro sí.
const ALLOWED_EMAILS = ["lazarillogestion@gmail.com"];

export function isAllowedEmail(email: string | null | undefined): boolean {
  return ALLOWED_EMAILS.includes(email ?? "");
}
