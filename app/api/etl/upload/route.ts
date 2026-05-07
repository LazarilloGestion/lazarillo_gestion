import { NextRequest, NextResponse } from "next/server";
import { runETL } from "@/lib/etl/run-etl";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
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

  // Guardar en Supabase Storage (no abortar si falla)
  let storagePath: string | undefined;
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
    const filename = (file as File).name ?? "archivo.xlsx";
    storagePath = `maestros/${date}/${time}_${filename}`;

    const { error: storageError } = await supabase.storage
      .from("uploads")
      .upload(storagePath, buffer, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });

    if (storageError) {
      console.error("[ETL] Storage upload failed:", storageError.message);
      storagePath = undefined;
    }
  } catch (err) {
    console.error("[ETL] Storage error:", err);
    storagePath = undefined;
  }

  try {
    const report = await runETL(buffer, storagePath);
    return NextResponse.json(report, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
