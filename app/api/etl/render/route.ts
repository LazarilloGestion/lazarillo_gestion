import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { renderConfigurado } from "@/lib/render/db";
import { listarItems, sincronizarItem, ultimaCorrida } from "@/lib/render/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET — qué hay en Render para el Panel y cuándo se leyó cada cosa por última vez.
export async function GET() {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  if (!renderConfigurado()) return NextResponse.json({ configurado: false, items: [], corrida: null });
  try {
    const [items, corrida] = await Promise.all([listarItems(), ultimaCorrida()]);
    return NextResponse.json({ configurado: true, items, corrida });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ configurado: true, items: [], error: `No se pudo leer Render: ${msg}` }, { status: 502 });
  }
}

const bodySchema = z.object({ id: z.string().min(1).max(200), forzar: z.boolean().optional() });

// POST { id, forzar? } — lee UNA tabla de Render (un PDV) y la pasa por el ETL.
// El cliente recorre los ítems de a uno y al final llama a /finalizar por local.
export async function POST(req: NextRequest) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  try {
    const item = (await listarItems()).find((i) => i.id === parsed.data.id);
    if (!item) return NextResponse.json({ error: "No existe en Render" }, { status: 404 });
    return NextResponse.json(await sincronizarItem(item, { forzar: parsed.data.forzar, triggeredBy: auth.user.id }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ id: parsed.data.id, error: msg }, { status: 500 });
  }
}
