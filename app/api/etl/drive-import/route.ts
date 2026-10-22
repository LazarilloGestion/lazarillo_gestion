import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { refreshGoogleAccessToken, downloadDriveFile } from "@/lib/drive/client";
import { runETL } from "@/lib/etl/run-etl";
import { getEtlClient } from "@/lib/etl/etl-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getFileOrder } from "@/lib/etl/file-processor";
import { getExcelHeaders } from "@/lib/etl/helpers";
import { detectFileType, buildTipoNoIdentificadoMessage } from "@/lib/etl/detect-file-type";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import type { ETLContext, ETLReport, DbClient, DriveImportResultItem } from "@/lib/etl/types";

const TRANSACTIONAL_TYPES = new Set(["compras", "detalleCompras", "pagos", "ventas"]);
const MAESTRO_FILE_TYPES = [
  "rubrosArticulo", "subrubrosArticulo", "rubrosConceptoCaja", "conceptosCaja", "articulos", "proveedores",
] as const;

// Un maestro "sin resolver" es el último import de ese tipo que terminó en
// estado='error' (excepción de runETL) O que igual logueó estado='ok' pero
// con filas rechazadas (errors.length > 0) — el ETL no aborta un archivo por
// errores fila a fila, así que un maestro con, digamos, 5 de 100 proveedores
// rechazados por Zod queda en 'ok' aunque esos 5 nunca se hayan actualizado.
// Server-side y por tipo de maestro (no por sesión de cliente): vale sin
// importar quién dispara el import de transaccionales — reload a mitad de
// ciclo, retry de solo la carpeta transaccional, o un script futuro (gap
// real detectado en code-review, 24-ago-2026 — antes esto solo se chequeaba
// en el estado del hook de React, y solo para archivos 100% fallidos).
async function maestrosConErrorSinResolver(): Promise<string[]> {
  const ultimos = await Promise.all(
    MAESTRO_FILE_TYPES.map((fileType) =>
      prisma.importLog.findFirst({
        where: { fileType },
        orderBy: { creadoEn: "desc" },
        select: { fileType: true, estado: true, errors: true },
      })
    )
  );
  return ultimos
    .filter((log): log is NonNullable<typeof log> => log != null)
    .filter((log) => log.estado === "error" || (Array.isArray(log.errors) && log.errors.length > 0))
    .map((log) => log.fileType!);
}

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
  const batchId = crypto.randomUUID();

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
    const maestrosConError = await maestrosConErrorSinResolver();
    if (maestrosConError.length > 0) {
      return NextResponse.json(
        {
          error: `El último import de estos maestros tuvo errores sin resolver: ${maestrosConError.join(", ")}. Corregilo antes de importar archivos transaccionales.`,
        },
        { status: 422 }
      );
    }
  }

  try {
    const accessToken = await refreshGoogleAccessToken(config.refresh_token);

    // Descargar todos los archivos en paralelo
    const downloaded = await Promise.all(
      fileInputs.map(async (f) => ({
        file_id: f.file_id,
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
    // fileId/fileName viajan junto a cada report para que el cliente pueda
    // batchear un POST por carpeta (en vez de uno por archivo) y aun así
    // actualizar el status individual de cada archivo en la UI — antes la
    // respuesta solo devolvía ETLReport[] sin ninguna forma de correlacionar
    // cada resultado con el archivo que lo generó (hallazgo de eficiencia,
    // code-review 24-ago-2026).
    const results: DriveImportResultItem[] = [];

    const [localRecord, pdvRecord] = await Promise.all([
      localId != null ? prisma.local.findUnique({ where: { id: localId }, select: { nombre: true } }) : null,
      puntoDeVentaId != null ? prisma.puntoDeVenta.findUnique({ where: { id: puntoDeVentaId }, select: { nombre: true } }) : null,
    ]);
    const localSlug = localId != null ? (localRecord ? slugify(localRecord.nombre) : String(localId)) : null;
    const pdvSlug = puntoDeVentaId != null ? (pdvRecord ? slugify(pdvRecord.nombre) : String(puntoDeVentaId)) : null;

    for (const { file_id, file_name, buffer } of sorted) {

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

      // Archivo cuyas columnas no matchean ningún ETLFileType conocido: no es
      // una excepción del sistema, es un archivo fuera de alcance (ej. un
      // export nuevo del ERP que este proyecto todavía no contempla). Se
      // ignora — se loguea aparte y se sigue con el resto del batch, sin
      // llegar a invocar runETL para este archivo.
      const headers = getExcelHeaders(buffer);
      const fileType = detectFileType(headers);
      if (!fileType) {
        const errorMessage = buildTipoNoIdentificadoMessage(headers);
        try {
          await prisma.importLog.create({
            data: {
              batchId,
              fileType: null,
              fileName: file_name,
              storagePath,
              localId,
              puntoDeVentaId,
              estado: "no_soportado",
              errorMessage,
              triggeredBy: user.id,
            },
          });
        } catch (logErr) {
          console.error("[POST /api/etl/drive-import] Falló el registro del ImportLog (no_soportado), se sigue sin loguear", { userId: user.id, file_name }, logErr);
        }
        results.push({ fileId: file_id, fileName: file_name, unsupported: true, errorMessage });
        continue;
      }

      let report: ETLReport;
      try {
        // Sin transacción global: cada chunk del normalizer hace su propio commit.
        // ON CONFLICT DO UPDATE garantiza idempotencia → reimports seguros.
        // Una transacción única de 55 s causaba timeout y rollback total en archivos grandes.
        report = await runETL(buffer, storagePath, ctx, getEtlClient() as unknown as DbClient);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        try {
          await prisma.importLog.create({
            data: {
              batchId,
              // Recalculado: la detección del loop de validación (línea ~164) no viaja hasta acá.
              fileType: detectFileType(getExcelHeaders(buffer)),
              fileName: file_name,
              storagePath,
              localId,
              puntoDeVentaId,
              estado: "error",
              errorMessage: message,
              triggeredBy: user.id,
            },
          });
        } catch (logErr) {
          console.error("[POST /api/etl/drive-import] Falló el registro del ImportLog (camino error), se sigue sin loguear", { userId: user.id, file_name }, logErr);
        }
        return NextResponse.json(
          {
            error: `Error procesando el archivo: ${message}`,
            results,
            failedFileId: file_id,
            failedFileName: file_name,
          },
          { status: 422 }
        );
      }
      try {
        await prisma.importLog.create({
          data: {
            batchId,
            fileType: report.fileType,
            fileName: file_name,
            storagePath: report.storagePath,
            localId,
            puntoDeVentaId,
            estado: "ok",
            totalRows: report.totalRows,
            created: report.created,
            updated: report.updated,
            skipped: report.skipped,
            // Acotado a 500: un header de columna corrido puede hacer fallar el archivo
            // entero, generando decenas de miles de errores/filas omitidas — el INSERT
            // resultante competía con el maxDuration=60 de esta ruta (ver nota arriba
            // sobre el timeout de 55s ya conocido). Los primeros 500 alcanzan para
            // diagnosticar el patrón sin ese riesgo.
            // ETLRowError.rawCodigo es `unknown` (valor crudo de celda xlsx) — no satisface
            // Prisma.InputJsonValue directamente aunque en la práctica siempre es serializable.
            errors: report.errors.slice(0, 500) as unknown as Prisma.InputJsonValue,
            skippedRows: report.skippedRows?.slice(0, 500) as unknown as Prisma.InputJsonValue | undefined,
            durationMs: report.durationMs,
            triggeredBy: user.id,
          },
        });
      } catch (logErr) {
        console.error("[POST /api/etl/drive-import] Falló el registro del ImportLog, se sigue sin loguear", { userId: user.id, file_name }, logErr);
      }
      results.push({ fileId: file_id, fileName: file_name, report });
    }

    // linkDetalleCompras/sincronizarAperturaSiCorresponde YA NO corren acá — se
    // movieron a POST /api/etl/drive-import/finalizar, que el cliente llama una
    // sola vez por carpeta (no una vez por tanda). Ver el comentario de ese
    // archivo para el motivo (reaplicarReglasActivas escala con el total de
    // reglas activas × compras sin distribuir, no con el tamaño de la tanda).
    return NextResponse.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
