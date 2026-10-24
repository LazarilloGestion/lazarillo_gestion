import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buscarProveedoresSql, type ProveedorBusquedaRow } from "@/lib/cta-cte/query";

export const dynamic = "force-dynamic";

// GET ?q: proveedores con comprobantes, para el buscador de la cuenta corriente.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const rows = await prisma.$queryRaw<ProveedorBusquedaRow[]>(buscarProveedoresSql(q));
  return NextResponse.json({
    proveedores: rows.map((r) => ({ codPro: r.cod_pro, nombre: r.nombre?.trim() || `Proveedor ${r.cod_pro}`, facturas: Number(r.facturas) })),
  });
}
