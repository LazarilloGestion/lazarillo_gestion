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

  const lineas = await prisma.detalleCompra.findMany({
    where: { compraId },
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
