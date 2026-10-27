import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET as pivot } from "@/app/api/dashboard/pivot/route";
import { GET as pivotVentas } from "@/app/api/dashboard/pivot-ventas/route";
import { GET as impagas } from "@/app/api/impagas/route";
import { GET as actualizado } from "@/app/api/dashboard/actualizado/route";
import { GET as flujo } from "@/app/api/dashboard/flujo-caja/route";
import { GET as difCaja } from "@/app/api/dashboard/diferencia-caja/route";

// TEMPORAL — rama de medición, NUNCA se mergea. Solo responde en preview (protegido
// por Vercel SSO) y devuelve únicamente tiempos: los datos no salen de la función.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type H = (r: NextRequest) => Promise<Response>;
const B = "https://x.local";
const CASOS: [string, H, string][] = [
  ["pivot económica", pivot as H, "/api/dashboard/pivot?year=2026"],
  ["pivot financiera", pivot as H, "/api/dashboard/pivot?year=2026&modo=financiera"],
  ["pivot económica Bar", pivot as H, "/api/dashboard/pivot?year=2026&localId=1&pdvId=1"],
  ["pivot financiera Bar", pivot as H, "/api/dashboard/pivot?year=2026&localId=1&pdvId=1&modo=financiera"],
  ["pivot ventas", pivotVentas as H, "/api/dashboard/pivot-ventas?year=2026"],
  ["impagas Bar", impagas as H, "/api/impagas?pdvId=1"],
  ["actualizado", actualizado as H, "/api/dashboard/actualizado"],
  ["flujo caja", flujo as H, "/api/dashboard/flujo-caja?anio=2026"],
  ["diferencia caja", difCaja as H, "/api/dashboard/diferencia-caja?year=2026"],
];

async function medir(h: H, path: string) {
  const t = performance.now();
  const res = await h(new NextRequest(B + path));
  const body = await res.arrayBuffer();
  return { ms: Math.round(performance.now() - t), status: res.status, kb: Math.round(body.byteLength / 1024) };
}

export async function GET(_req: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") return new NextResponse(null, { status: 404 });
  (globalThis as { __cronometro?: boolean }).__cronometro = true;
  try {
    const ping: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t = performance.now();
      await prisma.$queryRaw`select 1`;
      ping.push(Math.round(performance.now() - t));
    }
    const casos = [];
    for (const [nombre, h, path] of CASOS) {
      const corridas = [];
      for (let i = 0; i < 4; i++) corridas.push(await medir(h, path));
      casos.push({ nombre, status: corridas[0].status, kb: corridas[0].kb, ms: corridas.map((c) => c.ms) });
    }
    // Carga inicial del dashboard: lo que pide en paralelo al abrir.
    const inicial: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      await Promise.all(CASOS.filter(([n]) => ["pivot económica", "pivot ventas", "impagas Bar", "actualizado", "flujo caja", "diferencia caja"].includes(n)).map(([, h, p]) => medir(h, p)));
      inicial.push(Math.round(performance.now() - t));
    }
    return NextResponse.json({ region: process.env.VERCEL_REGION, ping, casos, inicial });
  } finally {
    (globalThis as { __cronometro?: boolean }).__cronometro = false;
  }
}
