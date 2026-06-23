import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { refreshGoogleAccessToken, downloadDriveFile } from "@/lib/drive/client";
import { runETL } from "@/lib/etl/run-etl";
import { getEtlClient } from "@/lib/etl/etl-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getFileOrder } from "@/lib/etl/file-processor";
import { linkDetalleCompras } from "@/lib/etl/link-detalle-compras";
import { getExcelHeaders } from "@/lib/etl/helpers";
import { detectFileType } from "@/lib/etl/detect-file-type";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import type { ETLContext, ETLReport, DbClient } from "@/lib/etl/types";

const TRANSACTIONAL_TYPES = new Set(["compras", "detalleCompras", "ventas"]);

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB por archivo

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const XLS_MAGIC  = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

function isValidExcel(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const h = buf.subarray(0, 4);
  return h.equals(XLSX_MAGIC) || h.equals(XLS_MAGIC);
}

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

  if (!rateLimit(user.id, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Esperá un momento." }, { status: 429 });
  }

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

  // Bloquear archivos transaccionales si los maestros no están cargados
  if (localId != null) {
    const [provCount, conceptoCount, artCount] = await Promise.all([
      getEtlClient().proveedor.count(),
      getEtlClient().conceptoCaja.count(),
      getEtlClient().articulo.count(),
    ]);
    if (provCount === 0 || conceptoCount === 0 || artCount === 0) {
      return NextResponse.json(
        { error: "Importá los maestros antes de importar archivos transaccionales." },
        { status: 422 }
      );
    }
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

    // Validar todos los archivos antes de procesar (evita commits parciales)
    for (const { file_name: fn, buffer } of sorted) {
      if (buffer.byteLength > MAX_SIZE)
        return NextResponse.json({ error: `El archivo "${fn}" supera el límite de 10 MB` }, { status: 413 });
      if (!isValidExcel(buffer))
        return NextResponse.json({ error: `El archivo "${fn}" no es un Excel válido (.xlsx o .xls)` }, { status: 400 });
      const fileType = detectFileType(getExcelHeaders(buffer));
      if (fileType && TRANSACTIONAL_TYPES.has(fileType) && localId == null)
        return NextResponse.json(
          { error: `El archivo "${fn}" es transaccional y requiere un local reconocido.` },
          { status: 422 }
        );
    }

    const ctx: ETLContext = { localId, puntoDeVentaId };
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const reports: ETLReport[] = [];

    const [localRecord, pdvRecord] = await Promise.all([
      localId != null ? prisma.local.findUnique({ where: { id: localId }, select: { nombre: true } }) : null,
      puntoDeVentaId != null ? prisma.puntoDeVenta.findUnique({ where: { id: puntoDeVentaId }, select: { nombre: true } }) : null,
    ]);
    const localSlug = localId != null ? (localRecord ? slugify(localRecord.nombre) : String(localId)) : null;
    const pdvSlug = puntoDeVentaId != null ? (pdvRecord ? slugify(pdvRecord.nombre) : String(puntoDeVentaId)) : null;

    for (const { file_name, buffer } of sorted) {

      // Archivar en Storage (best-effort)
      const time = new Date().toTimeString().slice(0, 8).replace(/:/g, "-");
      const category = localSlug != null
        ? `transaccionales/${localSlug}${pdvSlug ? `/${pdvSlug}` : ""}`
        : "maestros";
      let storagePath: string | undefined = `drive/${user.id}/${date}/${category}/${time}_${file_name}`;
      try {
        await admin.storage.from("uploads").upload(storagePath, buffer, {
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: false,
        });
      } catch {
        storagePath = undefined;
      }

      let report: ETLReport;
      try {
        // Sin transacción global: cada chunk del normalizer hace su propio commit.
        // ON CONFLICT DO UPDATE garantiza idempotencia → reimports seguros.
        // Una transacción única de 55 s causaba timeout y rollback total en archivos grandes.
        report = await runETL(buffer, storagePath, ctx, getEtlClient() as unknown as DbClient);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        return NextResponse.json(
          { error: `Error procesando el archivo: ${message}`, reports },
          { status: 422 }
        );
      }
      reports.push(report);
    }

    // Link detalle_compras → compras post-batch
    await linkDetalleCompras(getEtlClient() as unknown as DbClient, localId);

    return NextResponse.json(reports);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
