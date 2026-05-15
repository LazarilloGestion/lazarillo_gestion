import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Verifica sesión activa. Retorna null si autorizado, NextResponse 401 si no.
 * En desarrollo se omite para poder usar las APIs sin login configurado.
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) return null;

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
