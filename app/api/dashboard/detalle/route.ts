import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const localId = searchParams.get("localId") ? Number(searchParams.get("localId")) : undefined;
  const pdvId = searchParams.get("pdvId") ? Number(searchParams.get("pdvId")) : undefined;
  const mes = searchParams.get("mes") ? Number(searchParams.get("mes")) : undefined;
  const conceptoCodigo = searchParams.get("conceptoCodigo") ?? undefined;
  const proveedorId = searchParams.get("proveedorId")
    ? Number(searchParams.get("proveedorId"))
    : undefined;
  const rubroCodigo = searchParams.get("rubroCodigo") ?? undefined;

  const fechaStart = mes ? new Date(year, mes - 1, 1) : new Date(year, 0, 1);
  const fechaEnd = mes ? new Date(year, mes, 1) : new Date(year + 1, 0, 1);

  const where: Prisma.CompraWhereInput = {
    fecha: { gte: fechaStart, lt: fechaEnd },
    ...(localId !== undefined && { localId }),
    ...(pdvId !== undefined && { puntoDeVentaId: pdvId }),
    ...(conceptoCodigo && { conceptoCodigo }),
    ...(proveedorId !== undefined && { proveedorId }),
  };

  // Rubro filter: look up concepto codes belonging to this rubro
  if (rubroCodigo && !conceptoCodigo) {
    const conceptos = await prisma.conceptoCaja.findMany({
      where: { rubro: { codigo: rubroCodigo } },
      select: { codigo: true },
    });
    where.conceptoCodigo = { in: conceptos.map((c) => c.codigo) };
  }

  const compras = await prisma.compra.findMany({
    where,
    include: {
      conceptoCaja: { include: { rubro: true } },
      proveedorRef: true,
      local: true,
      puntoDeVenta: true,
    },
    orderBy: { fecha: "asc" },
    take: 500,
  });

  return NextResponse.json(compras);
}
