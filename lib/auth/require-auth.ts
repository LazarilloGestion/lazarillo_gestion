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
  // TEMPORAL rama de medición (nunca se mergea): solo en preview y solo dentro de /api/cron/cronometro.
  if (process.env.VERCEL_ENV === "preview" && (globalThis as { __cronometro?: boolean }).__cronometro) {
    return { user: { id: "cronometro", email: "cronometro" } as User, response: null };
  }
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
