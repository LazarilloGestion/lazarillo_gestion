import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { parseVentasParams } from "@/lib/dashboard/params";
import { SIN_TIPO_CODE, SIN_COBRO_CODE, DETALLE_VENTAS_LIMITE } from "@/lib/dashboard/constants";
import { mesSchema, yearSchema, codigoSchema } from "@/lib/dashboard/schemas";
import { buildDateRange } from "@/lib/dashboard/query-builders";
import { recortarConHasMore } from "@/lib/dashboard/recortar-has-more";

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
      OR: [
        { importeManual: { not: null }, NOT: { importeManual: 0 } },
        { importeManual: null, importe: { not: null }, NOT: { importe: 0 } },
      ],
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
    // Desempate por rowId: con fechas repetidas, qué ventas sobreviven al corte tiene que ser estable.
    orderBy: [{ fecha: "asc" }, { rowId: "asc" }],
    take: DETALLE_VENTAS_LIMITE + 1,
  });

  const { data, hasMore } = recortarConHasMore(ventas, DETALLE_VENTAS_LIMITE);
  return NextResponse.json({ data, hasMore });
}
