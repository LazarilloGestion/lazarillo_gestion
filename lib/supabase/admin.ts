import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// SERVICE_ROLE_KEY bypassa RLS por diseño de Supabase, con o sin políticas
// definidas — no usar este cliente asumiendo que RLS filtra algo. Ver SECURITY.md.
export function getSupabaseAdmin() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
