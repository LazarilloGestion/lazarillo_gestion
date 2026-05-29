import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { refreshGoogleAccessToken, downloadDriveFile } from "@/lib/drive/client";
import { runETL } from "@/lib/etl/run-etl";
import { getEtlClient } from "@/lib/etl/etl-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getFileOrder } from "@/lib/etl/file-processor";
import { prisma } from "@/lib/prisma";
import type { ETLContext, ETLReport, DbClient } from "@/lib/etl/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type FileInput = { file_id: string; file_name: string };

/**
 * POST — descarga archivos de Drive y los procesa con el ETL en orden de dependencia.
 * Body: { files: FileInput[]; local_id?: number; punto_de_venta_id?: number }
 *   o   { file_id: string; file_name: string; local_id?: number; punto_de_venta_id?: number }  (compat. individual)
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // Normalizar a array de archivos
  let fileInputs: FileInput[];
  if (Array.isArray(rawBody.files)) {
    const items = rawBody.files as unknown[];
    const valid = items.every(
      (x) => x != null && typeof (x as FileInput).file_id === "string" && typeof (x as FileInput).file_name === "string"
    );
    if (!valid) return NextResponse.json({ error: "Cada item de files debe tener file_id y file_name" }, { status: 400 });
    fileInputs = items as FileInput[];
  } else if (rawBody.file_id && rawBody.file_name) {
    fileInputs = [{ file_id: String(rawBody.file_id), file_name: String(rawBody.file_name) }];
  } else {
    return NextResponse.json({ error: "Se requiere files[] o file_id+file_name" }, { status: 400 });
  }

  const localIdRaw = rawBody.local_id != null ? Number(rawBody.local_id) : undefined;
  const puntoDeVentaIdRaw = rawBody.punto_de_venta_id != null ? Number(rawBody.punto_de_venta_id) : undefined;

  if (localIdRaw !== undefined && Number.isNaN(localIdRaw)) {
    return NextResponse.json({ error: "local_id debe ser un número" }, { status: 400 });
  }
  if (puntoDeVentaIdRaw !== undefined && Number.isNaN(puntoDeVentaIdRaw)) {
    return NextResponse.json({ error: "punto_de_venta_id debe ser un número" }, { status: 400 });
  }

  const localId = localIdRaw;
  const puntoDeVentaId = puntoDeVentaIdRaw;

  // Validar nombres de archivo (path traversal)
  for (const f of fileInputs) {
    const safe = path.basename(f.file_name);
    if (safe !== f.file_name) {
      return NextResponse.json({ error: `file_name inválido: ${f.file_name}` }, { status: 400 });
    }
  }

  const admin = getSupabaseAdmin();
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

    // Descargar todos los archivos en paralelo
    const downloaded = await Promise.all(
      fileInputs.map(async (f) => ({
        file_name: f.file_name,
        buffer: await downloadDriveFile(accessToken, f.file_id),
      }))
    );

    // Ordenar por dependencia FK antes de procesar
    const sorted = [...downloaded].sort(
      (a, b) => getFileOrder(a.buffer) - getFileOrder(b.buffer)
    );

    const ctx: ETLContext = { localId, puntoDeVentaId };
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const reports: ETLReport[] = [];

    function toSlug(s: string): string {
      return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-");
    }

    const [localRecord, pdvRecord] = await Promise.all([
      localId != null ? prisma.local.findUnique({ where: { id: localId }, select: { nombre: true } }) : null,
      puntoDeVentaId != null ? prisma.puntoDeVenta.findUnique({ where: { id: puntoDeVentaId }, select: { nombre: true } }) : null,
    ]);
    const localSlug = localId != null ? (localRecord ? toSlug(localRecord.nombre) : String(localId)) : null;
    const pdvSlug = pdvRecord ? toSlug(pdvRecord.nombre) : null;

    for (const { file_name, buffer } of sorted) {
      // Archivar en Storage (best-effort)
      const time = new Date().toTimeString().slice(0, 8).replace(/:/g, "-");
      const category = localSlug != null
        ? `transaccionales/${localSlug}${pdvSlug ? `/${pdvSlug}` : ""}`
        : "maestros";
      const storagePath = `drive/${user.id}/${date}/${category}/${time}_${file_name}`;
      try {
        await admin.storage.from("uploads").upload(storagePath, buffer, {
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: false,
        });
      } catch {
        // Storage es best-effort
      }

      const report = await runETL(buffer, storagePath, ctx, getEtlClient() as unknown as DbClient);
      reports.push(report);
    }

    // Link detalle_compras → compras post-batch
    if (localId != null) {
      await getEtlClient().$executeRaw`
        UPDATE detalle_compras dc
        SET "compraId" = c."rowId"
        FROM compras c
        WHERE dc.comprobante = c.comprobante
          AND dc."compraId" IS NULL
          AND c."localId" = ${localId}
      `;
    }

    return NextResponse.json(reports);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
