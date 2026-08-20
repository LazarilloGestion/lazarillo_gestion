import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { refreshGoogleAccessToken, downloadDriveFile } from "@/lib/drive/client";
import { runETL } from "@/lib/etl/run-etl";
import { getEtlClient } from "@/lib/etl/etl-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getFileOrder } from "@/lib/etl/file-processor";
import { linkDetalleCompras } from "@/lib/etl/link-detalle-compras";
import { sincronizarTrasImport } from "@/lib/apertura/reimportacion";
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

const fileInputSchema = z.object({
  file_id: z.string().min(1),
  file_name: z.string().min(1),
});

// Body: { files: FileInput[]; local_id?: number; punto_de_venta_id?: number }
//   o   { file_id: string; file_name: string; local_id?: number; punto_de_venta_id?: number }  (compat. individual)
const driveImportBodySchema = z
  .object({
    files: z.array(fileInputSchema).optional(),
    file_id: z.string().min(1).optional(),
    file_name: z.string().min(1).optional(),
    // Number(...) + Number.isNaN(...) del código original — z.coerce.number() replica
    // el mismo comportamiento sin endurecer con .positive()/.int() (no estaban antes).
    local_id: z.coerce.number().optional(),
    punto_de_venta_id: z.coerce.number().optional(),
  })
  .refine((b) => b.files !== undefined || (b.file_id != null && b.file_name != null), {
    message: "Se requiere files[] o file_id+file_name",
  });

/**
 * POST — descarga archivos de Drive y los procesa con el ETL en orden de dependencia.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  if (!rateLimit(user.id, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Esperá un momento." }, { status: 429 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = driveImportBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido" }, { status: 400 });
  }
  const body = parsed.data;

  const fileInputs: FileInput[] = body.files ?? [{ file_id: body.file_id!, file_name: body.file_name! }];
  const localId = body.local_id;
  const puntoDeVentaId = body.punto_de_venta_id;

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
      } catch (e) {
        console.error("[POST /api/etl/drive-import] Falló el archivado en Storage, se sigue sin archivar", { userId: user.id, file_name }, e);
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
        // Los archivos anteriores de este batch ya commitearon — sincronizar
        // apertura sobre lo que sí se importó antes de cortar, para no perder
        // la señal de compras distribuidas modificadas por esos archivos
        // previos (Fase D, revisión final de rama, hallazgo Critical C2: sin
        // esto, una reimportación futura del mismo archivo no detecta ningún
        // cambio porque el dato en la DB ya coincide). Se salta si el batch
        // parcial no tocó ninguna compra (hallazgo Important I3).
        const huboComprasTocadasParcial = reports.some((r) => r.fileType === "compras" && (r.created > 0 || r.updated > 0));
        const comprasModificadasParcial = reports.flatMap((r) => r.comprasDistribuidasModificadas ?? []);
        const aperturaParcial = huboComprasTocadasParcial
          ? await sincronizarTrasImport(getEtlClient(), comprasModificadasParcial)
          : { comprasRecalculadas: 0, reglasReaplicadas: 0, errores: [] };
        if (aperturaParcial.errores.length > 0) {
          console.error("[POST /api/etl/drive-import] apertura.errores (batch parcial)", aperturaParcial.errores);
        }
        return NextResponse.json(
          { error: `Error procesando el archivo: ${message}`, reports, apertura: aperturaParcial },
          { status: 422 }
        );
      }
      reports.push(report);
    }

    // Link detalle_compras → compras post-batch
    await linkDetalleCompras(getEtlClient() as unknown as DbClient, localId);

    // Apertura de Gastos (Fase D): compras ya distribuidas cuyos campos ERP
    // cambiaron se revierten y re-matchean contra las reglas activas, en la
    // misma pasada que también auto-aplica reglas activas a compras nuevas
    // que hayan llegado en este batch. Ver diseño técnico sección 6. Se
    // salta por completo si el batch no tocó ninguna compra (ej. import de
    // ventas o de un maestro) — evita reaplicar todas las reglas activas sin
    // motivo (revisión final de rama, hallazgo Important I3).
    const huboComprasTocadas = reports.some((r) => r.fileType === "compras" && (r.created > 0 || r.updated > 0));
    const comprasModificadas = reports.flatMap((r) => r.comprasDistribuidasModificadas ?? []);
    const apertura = huboComprasTocadas
      ? await sincronizarTrasImport(getEtlClient(), comprasModificadas)
      : { comprasRecalculadas: 0, reglasReaplicadas: 0, errores: [] };
    if (apertura.errores.length > 0) {
      console.error("[POST /api/etl/drive-import] apertura.errores", apertura.errores);
    }

    return NextResponse.json({ reports, apertura });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
