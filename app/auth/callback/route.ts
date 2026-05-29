import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      const { session } = data;

      console.log("[auth/callback] provider_refresh_token present:", !!session.provider_refresh_token);
      console.log("[auth/callback] provider_token present:", !!session.provider_token);

      // Persistir refresh token de Google para poder renovar el access token de Drive
      // provider_refresh_token solo viene en el primer consentimiento — guardarlo siempre que esté presente
      if (session.provider_refresh_token && session.user) {
        const admin = getSupabaseAdmin();
        const { error: upsertError } = await admin.from("user_drive_config").upsert(
          {
            user_id: session.user.id,
            refresh_token: session.provider_refresh_token,
          },
          { onConflict: "user_id", ignoreDuplicates: false }
        );
        if (upsertError) {
          console.error("[auth/callback] Error guardando refresh_token:", upsertError);
        } else {
          console.log("[auth/callback] refresh_token guardado OK para user:", session.user.id);
        }
      } else {
        console.warn("[auth/callback] Sin provider_refresh_token — token NO actualizado en DB");
      }

      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
