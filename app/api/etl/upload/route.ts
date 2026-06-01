import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { runETL } from "@/lib/etl/run-etl";
import { getFileOrder } from "@/lib/etl/file-processor";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { getEtlClient } from "@/lib/etl/etl-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import type { ETLContext, ETLReport, DbClient } from "@/lib/etl/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB por archivo

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const XLS_MAGIC  = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

function isValidExcel(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const h = buf.subarray(0, 4);
  return h.equals(XLSX_MAGIC) || h.equals(XLS_MAGIC);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  if (!rateLimit(user.id, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Esperá un momento." }, { status: 429 });
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

  const rawFiles = formData.getAll("files");
  const files = rawFiles.filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length === 0) {
    return NextResponse.json(
      { error: 'Se requiere al menos un archivo en el campo "files"' },
      { status: 400 }
    );
  }

  const ctx: ETLContext = {
    localId:        formData.get("localId") ? Number(formData.get("localId")) : undefined,
    puntoDeVentaId: formData.get("puntoDeVentaId") ? Number(formData.get("puntoDeVentaId")) : undefined,
  };

  type FileEntry = { file: File; buffer: Buffer; order: number };
  const entries: FileEntry[] = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json(
        { error: `El archivo supera el límite de 10 MB` },
        { status: 413 }
      );
    }

    if (!isValidExcel(buffer)) {
      return NextResponse.json(
        { error: `El archivo no es un Excel válido (.xlsx o .xls)` },
        { status: 400 }
      );
    }

    entries.push({ file, buffer, order: getFileOrder(buffer) });
  }

  entries.sort((a, b) => a.order - b.order);

  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch {
    // continúa sin storage
  }

  const reports: ETLReport[] = [];

  for (const { file, buffer } of entries) {
    let storagePath: string | undefined;
    if (supabaseAdmin) {
      try {
        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
        const safeName = path.basename(file.name);
        storagePath = `uploads/${date}/${time}_${safeName}`;
        const { error } = await supabaseAdmin.storage
          .from("uploads")
          .upload(storagePath, buffer, {
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            upsert: false,
          });
        if (error) storagePath = undefined;
      } catch {
        storagePath = undefined;
      }
    }

    try {
      const report = await getEtlClient().$transaction(
        async (tx) => runETL(buffer, storagePath, ctx, tx as unknown as DbClient),
        { timeout: 300_000 }
      );
      reports.push(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      return NextResponse.json(
        { error: `Error procesando el archivo: ${message}`, reports },
        { status: 422 }
      );
    }
  }

  if (ctx.localId != null) {
    await getEtlClient().$executeRaw`
      UPDATE detalle_compras dc
      SET "compraId" = c."rowId"
      FROM compras c
      WHERE dc.comprobante = c.comprobante
        AND dc."compraId" IS NULL
        AND c."localId" = ${ctx.localId}
    `;
  }

  return NextResponse.json(reports);
}
