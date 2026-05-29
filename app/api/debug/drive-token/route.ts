import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("user_drive_config")
    .select("refresh_token, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    user_id: user.id,
    has_refresh_token: !!data?.refresh_token,
    token_length: data?.refresh_token?.length ?? 0,
    updated_at: (data as { updated_at?: string } | null)?.updated_at ?? null,
  });
}
