import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { parseVentasParams } from "@/lib/dashboard/params";
import { SIN_TIPO_CODE, SIN_COBRO_CODE } from "@/lib/dashboard/constants";
import { z } from "zod";
import { mesSchema, yearSchema, codigoSchema } from "@/lib/dashboard/schemas";
import { buildDateRange } from "@/lib/dashboard/query-builders";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);

  const yearParsed = yearSchema.safeParse(searchParams.get("year") ?? new Date().getFullYear());
  const year = yearParsed.success ? yearParsed.data : new Date().getFullYear();

  const params = parseVentasParams(searchParams);
  const mes = mesSchema.safeParse(searchParams.get("mes")).data;

  const tipoCodigoRaw = searchParams.get("tipoCodigo");
  const cobroCodigoRaw = searchParams.get("cobroCodigo");
  const tipoCodigo = tipoCodigoRaw
    ? codigoSchema.safeParse(tipoCodigoRaw).data
    : undefined;
  const cobroCodigo = cobroCodigoRaw
    ? codigoSchema.safeParse(cobroCodigoRaw).data
    : undefined;

  const { fechaStart, fechaEnd } = buildDateRange(year, mes);

  const ventas = await prisma.venta.findMany({
    where: {
      fecha: { gte: fechaStart, lt: fechaEnd },
      ...(params.localId !== undefined && { localId: params.localId }),
      ...(params.pdvId !== undefined && { puntoDeVentaId: params.pdvId }),
      ...(tipoCodigo && { tipo: tipoCodigo === SIN_TIPO_CODE ? null : tipoCodigo }),
      ...(cobroCodigo && { codCobro: cobroCodigo === SIN_COBRO_CODE ? null : cobroCodigo }),
      NOT: {
        OR: [
          { importeManual: 0 },
          { importeManual: null, importe: 0 },
        ],
      },
    },
    select: {
      rowId: true,
      fecha: true,
      importe: true,
      importeManual: true,
      tipo: true,
      cobro: true,
      turno: true,
      comprobant: true,
      hora: true,
      mesa: true,
      mozo: true,
      total: true,
      descuento: true,
      cupon: true,
      local: { select: { nombre: true } },
      puntoDeVenta: { select: { nombre: true } },
    },
    orderBy: { fecha: "asc" },
    take: 2000,
  });

  return NextResponse.json({ data: ventas });
}
