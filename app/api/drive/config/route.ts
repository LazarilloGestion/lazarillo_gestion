import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { refreshGoogleAccessToken, getDriveFolderName } from "@/lib/drive/client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** GET — devuelve la config de Drive del usuario autenticado */
export async function GET() {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("user_drive_config")
    .select("folder_id, folder_name")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    folder_id: data?.folder_id ?? null,
    folder_name: data?.folder_name ?? null,
  });
}

const putBodySchema = z.object({
  folder_url: z.string().min(1, "folder_url requerido"),
});

/** PUT — guarda o actualiza la carpeta Drive del usuario
 *  Body: { folder_url: string }  (URL o ID directo de la carpeta)
 */
export async function PUT(req: NextRequest) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const rawBody = await req.json().catch(() => null);
  const parsed = putBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "folder_url requerido" }, { status: 400 });
  }
  const raw = parsed.data.folder_url.trim();
  if (!raw) return NextResponse.json({ error: "folder_url requerido" }, { status: 400 });

  // Extraer folder ID de URL o usar directamente si es un ID limpio
  const folderId = extractFolderId(raw);
  if (!folderId) return NextResponse.json({ error: "URL o ID de carpeta inválido" }, { status: 400 });

  const admin = getSupabaseAdmin();

  // Obtener refresh_token guardado para conseguir access token y resolver el nombre
  const { data: config } = await admin
    .from("user_drive_config")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  let folderName = folderId;
  if (config?.refresh_token) {
    try {
      const accessToken = await refreshGoogleAccessToken(config.refresh_token);
      folderName = await getDriveFolderName(accessToken, folderId);
    } catch {
      // No fatal — guardamos el ID si no podemos resolver el nombre
    }
  }

  const { error } = await admin.from("user_drive_config").upsert(
    { user_id: user.id, folder_id: folderId, folder_name: folderName },
    { onConflict: "user_id", ignoreDuplicates: false }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ folder_id: folderId, folder_name: folderName });
}

function extractFolderId(input: string): string | null {
  // https://drive.google.com/drive/folders/FOLDER_ID
  const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // ID directo (solo alfanumérico + guiones, 25-50 chars)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) return input;

  return null;
}
