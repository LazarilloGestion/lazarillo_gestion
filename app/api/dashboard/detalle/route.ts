import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";
import { mesSchema, yearSchema, idSchema, codigoSchema } from "@/lib/dashboard/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);

  const yearParsed = yearSchema.safeParse(searchParams.get("year") ?? new Date().getFullYear());
  const year = yearParsed.success ? yearParsed.data : new Date().getFullYear();

  const localId = idSchema.safeParse(searchParams.get("localId")).data;
  const pdvId = idSchema.safeParse(searchParams.get("pdvId")).data;
  const mes = mesSchema.safeParse(searchParams.get("mes")).data;
  const proveedorId = idSchema.safeParse(searchParams.get("proveedorId")).data;

  const conceptoCodigoRaw = searchParams.get("conceptoCodigo");
  const rubroCodigoRaw = searchParams.get("rubroCodigo");
  const conceptoCodigo = conceptoCodigoRaw
    ? codigoSchema.safeParse(conceptoCodigoRaw).data
    : undefined;
  const rubroCodigo = rubroCodigoRaw
    ? codigoSchema.safeParse(rubroCodigoRaw).data
    : undefined;

  const fechaStart = mes ? new Date(year, mes - 1, 1) : new Date(year, 0, 1);
  const fechaEnd = mes ? new Date(year, mes, 1) : new Date(year + 1, 0, 1);

  const where: Prisma.CompraWhereInput = {
    fecha: { gte: fechaStart, lt: fechaEnd },
    ...(localId !== undefined && { localId }),
    ...(pdvId !== undefined && { puntoDeVentaId: pdvId }),
    ...(conceptoCodigo && { conceptoCodigo }),
    ...(proveedorId !== undefined && { proveedorId }),
  };

  if (rubroCodigo && !conceptoCodigo) {
    const conceptos = await prisma.conceptoCaja.findMany({
      where: { codRga: rubroCodigo },
      select: { codigo: true },
    });
    where.conceptoCodigo = { in: conceptos.map((c) => c.codigo) };
  }

  const compras = await prisma.compra.findMany({
    where,
    select: {
      rowId: true,
      fecha: true,
      importe: true,
      proveedor: true,
      proveedorRef: {
        select: { id: true, nombre: true, razon: true },
      },
      local: { select: { nombre: true } },
      puntoDeVenta: { select: { nombre: true } },
      conceptoCaja: {
        select: {
          nombre: true,
          rubro: { select: { nombre: true } },
        },
      },
    },
    orderBy: { fecha: "asc" },
    take: 501,
  });

  const hasMore = compras.length > 500;
  const data = hasMore ? compras.slice(0, 500) : compras;

  return NextResponse.json({ data, hasMore });
}
