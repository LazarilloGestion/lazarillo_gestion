import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { refreshGoogleAccessToken, listDriveFiles } from "@/lib/drive/client";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const admin = createAdminClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  let config: { folder_id: string | null; refresh_token: string | null } | null;
  try {
    const { data, error } = await admin
      .from("user_drive_config")
      .select("folder_id, refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    config = data;
  } catch (err) {
    console.error("[drive/files] Error consultando config:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }

  if (!config?.folder_id) {
    return NextResponse.json({ error: "Sin carpeta configurada" }, { status: 404 });
  }
  if (!config.refresh_token) {
    return NextResponse.json({ error: "Sin token de Drive. Cerrá sesión y volvé a entrar." }, { status: 401 });
  }

  try {
    const accessToken = await refreshGoogleAccessToken(config.refresh_token);
    const files = await listDriveFiles(accessToken, config.folder_id);
    return NextResponse.json({ files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
