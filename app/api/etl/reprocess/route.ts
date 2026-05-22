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

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const supabaseAdmin = createAdminClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { searchParams } = new URL(req.url);
  const prefix = searchParams.get("prefix") ?? "uploads";

  const { data, error } = await supabaseAdmin.storage.from("uploads").list(prefix, {
    limit: 500,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ files: data });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  let body: { paths: string[]; localId?: number; puntoDeVentaId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body debe ser JSON" }, { status: 400 });
  }

  const { paths, localId, puntoDeVentaId } = body;

  if (!Array.isArray(paths) || paths.length === 0) {
    return NextResponse.json({ error: 'Se requiere al menos un path en "paths"' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  );

  const ctx: ETLContext = {
    localId: localId != null ? Number(localId) : undefined,
    puntoDeVentaId: puntoDeVentaId != null ? Number(puntoDeVentaId) : undefined,
  };

  type FileEntry = { path: string; buffer: Buffer; order: number };
  const entries: FileEntry[] = [];

  for (const path of paths) {
    const { data, error } = await supabaseAdmin.storage.from("uploads").download(path);
    if (error || !data) {
      return NextResponse.json(
        { error: `No se pudo descargar "${path}": ${error?.message ?? "sin datos"}` },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const headers = getExcelHeaders(buffer);
    const fileType = detectFileType(headers);
    const idx = fileType ? DEPENDENCY_ORDER.indexOf(fileType) : -1;
    entries.push({ path, buffer, order: idx === -1 ? 999 : idx });
  }

  entries.sort((a, b) => a.order - b.order);

  const reports: ETLReport[] = [];

  for (const { path, buffer } of entries) {
    try {
      const report = await getEtlClient().$transaction(
        async (tx) => runETL(buffer, path, ctx, tx as unknown as DbClient),
        { timeout: 300_000 }
      );
      reports.push(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      return NextResponse.json(
        { error: `Error procesando "${path}": ${message}`, reports },
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
