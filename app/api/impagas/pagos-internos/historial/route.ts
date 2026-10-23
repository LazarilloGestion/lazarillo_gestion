import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { historialSql, type EventoSqlRow } from "@/lib/impagas/query";

export const dynamic = "force-dynamic";

// GET ?pdvDestinoId&pdvOrigenId: historial de las órdenes de pago entre dos PDV.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const destino = Number(sp.get("pdvDestinoId"));
  const origen = Number(sp.get("pdvOrigenId"));
  if (!Number.isInteger(destino) || !Number.isInteger(origen) || destino <= 0 || origen <= 0) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  const rows = await prisma.$queryRaw<EventoSqlRow[]>(historialSql(destino, origen));
  return NextResponse.json({
    eventos: rows.map((r) => ({
      id: r.id, pagoId: r.pago_id, tipo: r.tipo, detalle: r.detalle,
      importe: r.importe == null ? null : Number(r.importe), usuario: r.usuario, cuando: r.cuando, anulada: r.anulada,
    })),
  });
}
