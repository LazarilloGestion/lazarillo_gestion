import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const mesSchema = z.coerce.number().int().min(1).max(12);
const yearSchema = z.coerce.number().int().min(1900).max(2100);
const idSchema = z.coerce.number().int().positive();

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

  // Validar strings de códigos: máx 50 chars, solo permitir si pasan
  const conceptoCodigoRaw = searchParams.get("conceptoCodigo");
  const rubroCodigoRaw = searchParams.get("rubroCodigo");
  const conceptoCodigo = conceptoCodigoRaw
    ? z.string().max(50).safeParse(conceptoCodigoRaw).data
    : undefined;
  const rubroCodigo = rubroCodigoRaw
    ? z.string().max(50).safeParse(rubroCodigoRaw).data
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

  // Rubro filter: resolver conceptos del rubro en una sola query,
  // luego usarlos como condición IN (evita N+1 y saca ventaja del índice codRga).
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
    take: 500,
  });

  return NextResponse.json(compras);
}
