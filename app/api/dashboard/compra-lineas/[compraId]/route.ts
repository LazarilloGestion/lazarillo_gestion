import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ compraId: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { compraId } = await params;

  // Buscar también por comprobante: el link ETL puede estar pendiente si
  // compras se importó antes que detalle_compras en una sesión anterior.
  const compra = await prisma.compra.findUnique({
    where: { rowId: compraId },
    select: { comprobante: true },
  });

  // Incluir filas aún no vinculadas (compraId: null) que compartan el comprobante.
  // Restringir a compraId: null evita traer filas de otros locales que tengan el mismo
  // string de comprobante pero ya estén correctamente vinculadas a su propia compra.
  const where = compra?.comprobante
    ? { OR: [{ compraId }, { comprobante: compra.comprobante, compraId: null }] }
    : { compraId };

  const lineas = await prisma.detalleCompra.findMany({
    where,
    select: {
      rowId: true,
      codigo: true,
      nombre: true,
      cantidad: true,
      medida: true,
      neto: true,
      totalIns: true,
      observac: true,
    },
    orderBy: { rowId: "asc" },
  });

  return NextResponse.json({ data: lineas });
}
