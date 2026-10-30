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
  const body = await request.json().catch(() => null);
  const d = leer(body);
  if (!d) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    // Si era uno detectado y descartado, vuelve a valer.
    await prisma.$executeRaw`INSERT INTO aumentos_precio ("puntoDeVentaId", fecha, origen) VALUES (${d.pdvId}, ${d.fecha}::date, 'manual') ON CONFLICT ("puntoDeVentaId", fecha) DO UPDATE SET descartado = false`;
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
    // Uno detectado se marca descartado (si se borrara, la próxima detección lo volvería a agregar).
    await prisma.$executeRaw`UPDATE aumentos_precio SET descartado = true WHERE "puntoDeVentaId" = ${d.pdvId} AND fecha = ${d.fecha}::date AND origen = 'detectado'`;
    await prisma.$executeRaw`DELETE FROM aumentos_precio WHERE "puntoDeVentaId" = ${d.pdvId} AND fecha = ${d.fecha}::date AND origen = 'manual'`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/dashboard/canasta/aumentos]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
