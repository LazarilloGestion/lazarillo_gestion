import { NextRequest, NextResponse } from "next/server";
import { runETL } from "@/lib/etl/run-etl";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { ETLContext } from "@/lib/etl/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  // Auth check: debe haber sesión activa
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: 'Se requiere un campo "file" con el archivo Excel' },
      { status: 400 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength > MAX_SIZE) {
    return NextResponse.json(
      { error: "El archivo supera el límite de 10 MB" },
      { status: 413 }
    );
  }

  // Contexto de local/punto de venta (opcional en formulario)
  const localIdRaw = formData.get("localId");
  const puntoDeVentaIdRaw = formData.get("puntoDeVentaId");
  const ctx: ETLContext = {
    localId:        localIdRaw ? Number(localIdRaw) : undefined,
    puntoDeVentaId: puntoDeVentaIdRaw ? Number(puntoDeVentaIdRaw) : undefined,
  };

  // Guardar en Supabase Storage con service role (no abortar si falla)
  let storagePath: string | undefined;
  try {
    const supabaseAdmin = createAdminClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
    const filename = (file as File).name ?? "archivo.xlsx";
    storagePath = `uploads/${date}/${time}_${filename}`;

    const { error: storageError } = await supabaseAdmin.storage
      .from("uploads")
      .upload(storagePath, buffer, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });

    if (storageError) {
      storagePath = undefined;
    }
  } catch {
    storagePath = undefined;
  }

  try {
    const report = await runETL(buffer, storagePath, ctx);
    return NextResponse.json(report, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
