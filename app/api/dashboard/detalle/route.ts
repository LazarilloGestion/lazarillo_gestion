import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { mesSchema, yearSchema, idSchema, codigoSchema } from "@/lib/dashboard/schemas";
import { buildDateRange } from "@/lib/dashboard/query-builders";

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

  const { fechaStart, fechaEnd } = buildDateRange(year, mes);

  const where: Prisma.CompraWhereInput = {
    AND: [
      {
        OR: [
          { fechaManual: { gte: fechaStart, lt: fechaEnd } },
          { fechaManual: null, fecha: { gte: fechaStart, lt: fechaEnd } },
        ],
      },
    ],
    ...(localId !== undefined && { localId }),
    ...(pdvId !== undefined && { puntoDeVentaId: pdvId }),
    ...(proveedorId !== undefined && { proveedorId }),
    ...(conceptoCodigo && {
      OR: [
        { conceptoCodigoManual: conceptoCodigo },
        { conceptoCodigoManual: null, conceptoCodigo },
      ],
    }),
  };

  if (rubroCodigo && !conceptoCodigo) {
    const conceptos = await prisma.conceptoCaja.findMany({
      where: { codRga: rubroCodigo },
      select: { codigo: true },
    });
    const codigos = conceptos.map((c) => c.codigo);
    where.OR = [
      ...(Array.isArray(where.OR) ? where.OR : []),
      { conceptoCodigoManual: { in: codigos } },
      { conceptoCodigoManual: null, conceptoCodigo: { in: codigos } },
    ];
  } else if (!rubroCodigo && !conceptoCodigo) {
    // Cuando no hay filtro de rubro/concepto activo, excluir rubros ocultos
    // para que el detalle coincida con los totales del pivot.
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { conceptoCaja: { rubro: { visibleEnDashboard: true } } },
          { conceptoCodigo: null },
        ],
      },
    ];
  }

  const compras = await prisma.compra.findMany({
    where,
    select: {
      rowId: true,
      fecha: true,
      importe: true,
      importeManual: true,
      fechaManual: true,
      conceptoCodigoManual: true,
      concepto: true,
      detalle: true,
      observac: true,
      observacManual: true,
      proveedor: true,
      proveedorRef: {
        select: { id: true, nombre: true, razon: true },
      },
      local: { select: { nombre: true } },
      puntoDeVenta: { select: { nombre: true } },
      conceptoCaja: {
        select: {
          codigo: true,
          nombre: true,
          rubro: { select: { nombre: true } },
        },
      },
      conceptoCajaManual: {
        select: {
          codigo: true,
          nombre: true,
          rubro: { select: { nombre: true } },
        },
      },
    },
    orderBy: { fecha: "asc" },
    take: 2000,
  });

  return NextResponse.json({ data: compras });
}
