// Botón para saltar entre el Panel de Container (Ramos/San Justo) y el de Comercio (Diego 29/10/2026).
// Solo para la cuenta de Lazarillo: el usuario de Comercio no lo ve. Cada Panel sabe cuál es por su
// proyecto de Supabase.
const PANEL_CONTAINER = "https://lazarillo-gestion.vercel.app/dashboard";
const PANEL_COMERCIO = "https://lazarillo-gestion-comercio.vercel.app/dashboard";
const REF_COMERCIO = "xvdzyqyylmsglpxycezk";
const CUENTAS = new Set(["lazarillogestion@gmail.com"]);

export function saltoPanel(email: string | null | undefined, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): { href: string; label: string } | null {
  if (!email || !CUENTAS.has(email.trim().toLowerCase())) return null;
  return supabaseUrl.includes(REF_COMERCIO)
    ? { href: PANEL_CONTAINER, label: "Ir a Container" }
    : { href: PANEL_COMERCIO, label: "Ir a Comercio" };
}
