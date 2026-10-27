import { NextRequest, NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { GET as pivot } from "@/app/api/dashboard/pivot/route";
import { GET as detalle } from "@/app/api/dashboard/detalle/route";

// TEMPORAL — rama de medición, NUNCA se mergea. Solo preview; devuelve solo tiempos y tamaños.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type H = (r: NextRequest) => Promise<Response>;
const B = "https://x.local";
const CASOS: [string, H, string][] = [
  ["pivot eco todo", pivot as H, "/api/dashboard/pivot?year=2026"],
  ["pivot eco Bar", pivot as H, "/api/dashboard/pivot?year=2026&localId=1&pdvId=1"],
  ["pivot fin Bar", pivot as H, "/api/dashboard/pivot?year=2026&localId=1&pdvId=1&modo=financiera"],
  ["pivot proveedor Bar", pivot as H, "/api/dashboard/pivot?year=2026&localId=1&pdvId=1&agrupacion=proveedor"],
  ["detalle 885 año Bar", detalle as H, "/api/dashboard/detalle?year=2026&localId=1&pdvId=1&conceptoCodigo=885"],
  ["detalle 885 oct Bar", detalle as H, "/api/dashboard/detalle?year=2026&localId=1&pdvId=1&conceptoCodigo=885&mes=10"],
  ["detalle todo oct Bar", detalle as H, "/api/dashboard/detalle?year=2026&localId=1&pdvId=1&mes=10"],
  ["detalle todo año Bar", detalle as H, "/api/dashboard/detalle?year=2026&localId=1&pdvId=1"],
  ["detalle fin oct Bar", detalle as H, "/api/dashboard/detalle?year=2026&localId=1&pdvId=1&mes=10&modo=financiera"],
];

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") return new NextResponse(null, { status: 404 });
  (globalThis as { __cronometro?: boolean }).__cronometro = true;
  try {
    const out = [];
    for (const [nombre, h, path] of CASOS) {
      const ms: number[] = [];
      let kb = 0, gz = 0, parse = 0, filas = 0, status = 0;
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        const res = await h(new NextRequest(B + path));
        const txt = await res.text();
        ms.push(Math.round(performance.now() - t));
        status = res.status;
        kb = Math.round(txt.length / 1024);
        const tp = performance.now();
        const j = JSON.parse(txt);
        parse = Math.round(performance.now() - tp);
        filas = Array.isArray(j?.data) ? j.data.length : (j?.rows ?? []).reduce((a: number, r: { children?: { children?: unknown[] }[] }) => a + (r.children ?? []).reduce((b, c) => b + (c.children?.length ?? 0), 0), 0);
        gz = Math.round(gzipSync(txt).length / 1024);
      }
      out.push({ nombre, status, ms, kb, gzKb: gz, parseMs: parse, filas });
    }
    return NextResponse.json({ region: process.env.VERCEL_REGION, out });
  } finally {
    (globalThis as { __cronometro?: boolean }).__cronometro = false;
  }
}
