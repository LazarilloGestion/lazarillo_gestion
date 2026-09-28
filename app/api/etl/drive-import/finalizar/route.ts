import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { getEtlClient } from "@/lib/etl/etl-client";
import { linkDetalleCompras } from "@/lib/etl/link-detalle-compras";
import { sincronizarTrasImport, type SincronizarTrasImportResultado } from "@/lib/apertura/reimportacion";
import type { DbClient } from "@/lib/etl/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  local_id: z.coerce.number().optional(),
  compras_modificadas: z.array(z.string()).default([]),
  hubo_compras_tocadas: z.boolean(),
});

const SIN_APERTURA: SincronizarTrasImportResultado = {
  comprasRecalculadas: 0,
  reglasReaplicadas: 0,
  errores: [],
  omitidas: [],
};

/**
 * POST — cierra una carpeta de import: linkea detalle_compras → compras y
 * sincroniza apertura de gastos, UNA SOLA VEZ por carpeta (no por tanda).
 *
 * Se separó de POST /api/etl/drive-import (que corre por cada tanda de 5
 * archivos) porque reaplicarReglasActivas reescanea TODAS las compras
 * esDistribuido=false contra TODAS las reglas activas — con Ramos Mejía
 * (139 reglas, ~55.000 compras sin distribuir por el backlog histórico que
 * se está importando) correrlo una vez por tanda multiplicaba ese costo por
 * la cantidad de tandas de la carpeta, y una tanda que antes entraba
 * cómoda en el presupuesto de 60s empezó a superarlo (Vercel Runtime
 * Timeout Error, 28-sep-2026). El cliente acumula comprasModificadas de
 * todas las tandas ya procesadas y llama acá una sola vez al terminar.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;

  const rawBody = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido" }, { status: 400 });
  }
  const { local_id: localId, compras_modificadas: comprasModificadas, hubo_compras_tocadas: huboComprasTocadas } = parsed.data;

  try {
    await linkDetalleCompras(getEtlClient() as unknown as DbClient, localId);

    if (!huboComprasTocadas) {
      return NextResponse.json({ apertura: SIN_APERTURA });
    }

    let apertura: SincronizarTrasImportResultado;
    try {
      apertura = await sincronizarTrasImport(getEtlClient(), comprasModificadas);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      apertura = { ...SIN_APERTURA, errores: [`sincronizarTrasImport: ${message}`] };
    }
    if (apertura.errores.length > 0) {
      console.error("[POST /api/etl/drive-import/finalizar] apertura.errores", apertura.errores);
    }
    return NextResponse.json({ apertura });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
