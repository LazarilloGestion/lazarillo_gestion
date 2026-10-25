import { NextRequest, NextResponse } from "next/server";
import { renderConfigurado } from "@/lib/render/db";
import { sincronizarTodo } from "@/lib/render/sync";

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
  const { resultados, pendientes } = await sincronizarTodo({ presupuestoMs: 240_000, triggeredBy: "cron-render" });
  const resumen = {
    leidos: resultados.filter((r) => "report" in r).length,
    sinCambios: resultados.filter((r) => "sinCambios" in r).length,
    errores: resultados.filter((r) => "error" in r).map((r) => ("error" in r ? `${r.id}: ${r.error}` : "")),
    pendientes,
  };
  console.log("[cron/render]", JSON.stringify(resumen));
  return NextResponse.json({ ok: true, ...resumen });
}
