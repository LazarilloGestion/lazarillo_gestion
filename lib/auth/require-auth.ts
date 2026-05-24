import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Segunda capa de protección para API Route Handlers (defense in depth).
 * El middleware ya bloquea requests sin sesión, pero esto valida explícitamente
 * dentro del handler. Retorna null si autorizado, NextResponse 401 si no.
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return null;
}

/**
 * Como requireAuth() pero retorna el user autenticado para que el handler
 * no necesite llamar getUser() una segunda vez.
 */
export async function requireAuthUser(): Promise<
  { user: User; response: null } | { user: null; response: NextResponse }
> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  return { user, response: null };
}
