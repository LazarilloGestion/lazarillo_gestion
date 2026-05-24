import { NextRequest, NextResponse } from "next/server";
import { runETL } from "@/lib/etl/run-etl";
import { requireAuth } from "@/lib/auth/require-auth";
import { getFileOrder } from "@/lib/etl/file-processor";
import { getEtlClient } from "@/lib/etl/etl-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ETLContext, ETLReport, DbClient } from "@/lib/etl/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const supabaseAdmin = getSupabaseAdmin();

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

  const supabaseAdmin = getSupabaseAdmin();

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
    entries.push({ path, buffer, order: getFileOrder(buffer) });
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
