import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { finalizarLocal } from "@/lib/render/sync";
import type { ETLReport } from "@/lib/etl/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  local_id: z.number().int(),
  compras: z.object({ created: z.number(), updated: z.number(), comprasDistribuidasModificadas: z.array(z.string()).optional() }).array(),
});

// POST — cierre de un local después de leer de Render (vincular detalle con
// compras + reaplicar apertura si cambiaron compras). Mismo criterio que
// /api/etl/drive-import/finalizar.
export async function POST(req: NextRequest) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  try {
    const reports = parsed.data.compras.map((c) => ({ ...c, fileType: "compras" }) as unknown as ETLReport);
    await finalizarLocal(parsed.data.local_id, reports);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
