import { NextRequest, NextResponse } from "next/server";
import { runETL } from "@/lib/etl/run-etl";
import { getExcelHeaders } from "@/lib/etl/helpers";
import { detectFileType } from "@/lib/etl/detect-file-type";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { requireAuth } from "@/lib/auth/require-auth";
import type { ETLContext, ETLReport, DbClient } from "@/lib/etl/types";

// Cliente Prisma con conexión directa (sin PgBouncer) para transacciones largas de ETL.
// DATABASE_URL usa pgbouncer=true (transaction pooling) que interrumpe tx >30s.
// DIRECT_URL apunta al pooler en modo session o al servidor directo.
const g = globalThis as unknown as { _prismaEtl?: PrismaClient };
function getEtlClient(): PrismaClient {
  if (!g._prismaEtl) {
    const url = env.DIRECT_URL ?? env.DATABASE_URL;
    g._prismaEtl = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }
  return g._prismaEtl;
}

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB por archivo

const DEPENDENCY_ORDER = [
  "rubrosConceptoCaja",
  "rubrosArticulo",
  "subrubrosArticulo",
  "conceptosCaja",
  "articulos",
  "proveedores",
  "compras",
  "detalleCompras",
  "ventas",
];

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

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

  // Leer buffers y detectar tipos para ordenar por dependencia FK
  type FileEntry = { file: File; buffer: Buffer; order: number };
  const entries: FileEntry[] = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json(
        { error: `"${file.name}" supera el límite de 10 MB` },
        { status: 413 }
      );
    }

    const headers = getExcelHeaders(buffer);
    const fileType = detectFileType(headers);
    const idx = fileType ? DEPENDENCY_ORDER.indexOf(fileType) : -1;
    entries.push({ file, buffer, order: idx === -1 ? 999 : idx });
  }

  entries.sort((a, b) => a.order - b.order);

  // Storage admin client (reutilizado para todos los archivos)
  let supabaseAdmin: ReturnType<typeof createAdminClient> | null = null;
  try {
    supabaseAdmin = createAdminClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY
    );
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
        storagePath = `uploads/${date}/${time}_${file.name}`;
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
      // Cada archivo se procesa en una transacción atómica.
      // Si el ETL lanza (tipo no detectado, error de parse), se hace rollback completo.
      // Errores de fila individuales se colectan dentro del normalizer sin abortar.
      const report = await getEtlClient().$transaction(
        async (tx) => runETL(buffer, storagePath, ctx, tx as unknown as DbClient),
        { timeout: 300_000 } // 5 min — usa DIRECT_URL para evitar límites de PgBouncer
      );
      reports.push(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      return NextResponse.json(
        { error: `Error procesando "${file.name}": ${message}`, reports },
        { status: 422 }
      );
    }
  }

  // Link global post-batch: cubre el caso donde compras y detalles
  // se subieron en sesiones separadas o en orden inverso al esperado.
  // Scope por localId para evitar cross-links entre locales distintos.
  if (ctx.localId != null) {
    await getEtlClient().$executeRaw`
      UPDATE detalle_compras dc
      SET "compraId" = c."rowId"
      FROM compras c
      WHERE dc.comprobante = c.comprobante
        AND dc."compraId" IS NULL
        AND c."localId" = ${ctx.localId}
    `;
  } else {
    await getEtlClient().$executeRaw`
      UPDATE detalle_compras dc
      SET "compraId" = c."rowId"
      FROM compras c
      WHERE dc.comprobante = c.comprobante
        AND dc."compraId" IS NULL
    `;
  }

  return NextResponse.json(reports);
}
