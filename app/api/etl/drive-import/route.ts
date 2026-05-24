import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { refreshGoogleAccessToken, downloadDriveFile } from "@/lib/drive/client";
import { runETL } from "@/lib/etl/run-etl";
import type { ETLContext, DbClient } from "@/lib/etl/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const g = globalThis as unknown as { _prismaEtlDrive?: PrismaClient };
function getEtlClient(): DbClient {
  if (!g._prismaEtlDrive) {
    const url = env.DIRECT_URL ?? env.DATABASE_URL;
    g._prismaEtlDrive = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }
  return g._prismaEtlDrive;
}

/** POST — descarga un archivo de Drive y lo procesa con el ETL
 *  Body: { file_id: string; file_name: string; local_id?: number; punto_de_venta_id?: number }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  let body: { file_id: string; file_name: string; local_id?: number; punto_de_venta_id?: number };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.file_id || !body.file_name) {
    return NextResponse.json({ error: "file_id y file_name requeridos" }, { status: 400 });
  }

  // Prevenir path traversal: solo usar el nombre base del archivo
  const safeName = path.basename(body.file_name);
  if (safeName !== body.file_name) {
    return NextResponse.json({ error: "file_name inválido" }, { status: 400 });
  }

  const admin = createAdminClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: config } = await admin
    .from("user_drive_config")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!config?.refresh_token) {
    return NextResponse.json(
      { error: "Sin token de Drive. Cerrá sesión y volvé a entrar." },
      { status: 401 }
    );
  }

  try {
    const accessToken = await refreshGoogleAccessToken(config.refresh_token);
    const buffer = await downloadDriveFile(accessToken, body.file_id);

    const ctx: ETLContext = {
      localId: body.local_id,
      puntoDeVentaId: body.punto_de_venta_id,
    };

    const db = getEtlClient();
    const storagePath = `drive/${user.id}/${safeName}`;
    const report = await runETL(buffer, storagePath, ctx, db);

    return NextResponse.json([report]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
