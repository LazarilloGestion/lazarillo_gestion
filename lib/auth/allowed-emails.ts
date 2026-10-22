// Allowlist de cuentas que pueden usar la app. Vive acá (sin dependencias
// de Next/Supabase) para que sea importable tanto desde proxy.ts (Edge
// Runtime) como desde lib/auth/require-auth.ts (Node runtime) — los
// clientes de Supabase de cada uno NO se pueden compartir entre sí, pero
// este helper puro sí.
//
// Se configura con la variable ALLOWED_EMAILS (emails separados por coma),
// así el mismo código sirve a más de una instancia del Panel (Ramos y
// Comercio tienen cada una su proyecto de Vercel y su base). Sin la
// variable, queda la cuenta original.
const DEFAULT_ALLOWED_EMAILS = ["lazarillogestion@gmail.com"];

export function parseAllowedEmails(raw: string | undefined): string[] {
  const lista = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return lista.length > 0 ? lista : DEFAULT_ALLOWED_EMAILS;
}

const ALLOWED_EMAILS = parseAllowedEmails(process.env.ALLOWED_EMAILS);

export function isAllowedEmail(email: string | null | undefined): boolean {
  return ALLOWED_EMAILS.includes((email ?? "").trim().toLowerCase());
}
