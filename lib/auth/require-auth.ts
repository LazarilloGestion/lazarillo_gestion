import { NextResponse } from "next/server";
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
