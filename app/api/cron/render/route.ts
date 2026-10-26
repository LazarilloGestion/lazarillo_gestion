import { NextRequest, NextResponse } from "next/server";
import { renderConfigurado } from "@/lib/render/db";
import { abrirCorrida, ejecutarCorrida, ultimaCorrida } from "@/lib/render/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// Cron diario de Vercel (vercel.json): lee de Render lo que cambió desde ayer.
// Con CRON_SECRET configurado exige "Authorization: Bearer <secreto>" (Vercel
// lo manda solo). Sin secreto acepta solo el llamado del cron de Vercel; lo peor
// que puede hacer un llamado ajeno es adelantar la lectura (es idempotente).
function autorizado(req: NextRequest): boolean {
  const secreto = process.env.CRON_SECRET;
  if (secreto) return req.headers.get("authorization") === `Bearer ${secreto}`;
  return (req.headers.get("user-agent") ?? "").startsWith("vercel-cron");
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!renderConfigurado()) return NextResponse.json({ ok: false, motivo: "Falta RENDER_DATABASE_URL" });
  // Misma corrida que el botón (con el mismo candado: si alguien ya la largó, no se duplica).
  const id = await abrirCorrida("cron");
  if (id == null) return NextResponse.json({ ok: true, yaCorriendo: true });
  await ejecutarCorrida(id, "cron-render");
  const c = await ultimaCorrida();
  console.log("[cron/render]", JSON.stringify({ estado: c?.estado, hechos: c?.hechos, total: c?.total }));
  return NextResponse.json({ ok: true, estado: c?.estado, hechos: c?.hechos, total: c?.total });
}
