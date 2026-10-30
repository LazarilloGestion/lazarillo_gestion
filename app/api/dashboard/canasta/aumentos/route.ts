import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
function leer(body: unknown): { pdvId: number; fecha: string } | null {
  const b = body as { pdvId?: unknown; fecha?: unknown } | null;
  const pdvId = Number(b?.pdvId), fecha = String(b?.fecha ?? "");
  if (!Number.isInteger(pdvId) || pdvId <= 0 || !FECHA.test(fecha) || Number.isNaN(Date.parse(fecha))) return null;
  return { pdvId, fecha };
}

// POST { pdvId, fecha } — anota un aumento de precios de la carta (sin duplicar).
export async function POST(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const d = leer(await request.json().catch(() => null));
  if (!d) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    await prisma.$executeRaw`INSERT INTO aumentos_precio ("puntoDeVentaId", fecha, origen) VALUES (${d.pdvId}, ${d.fecha}::date, 'manual') ON CONFLICT DO NOTHING`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/dashboard/canasta/aumentos]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE { pdvId, fecha } — saca un aumento mal anotado (o mal detectado).
export async function DELETE(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const d = leer(await request.json().catch(() => null));
  if (!d) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    await prisma.$executeRaw`DELETE FROM aumentos_precio WHERE "puntoDeVentaId" = ${d.pdvId} AND fecha = ${d.fecha}::date`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/dashboard/canasta/aumentos]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
