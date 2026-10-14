import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { whereLineasDeCompra } from "@/lib/dashboard/compra-lineas";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ compraId: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { compraId } = await params;

  // Buscar por comprobante (no por compraId): cuando una misma factura del ERP
  // se importa dividida en varias filas de `compras` por concepto (mismo
  // comprobante, distinto rowId), el link de ETL por comprobante no tiene forma
  // de decidir a cuál de esas filas pertenece cada línea de detalle y termina
  // concentrando el 100% de las líneas en una sola — dejando las demás en 0
  // (bug reportado: facturas de "papelera" sin detalle). Como el dato de origen
  // no distingue líneas por concepto, mostramos la factura completa bajo
  // cualquiera de sus filas divididas en vez de un desglose que no se puede
  // sostener. `localId` evita mezclar facturas de distintos locales que por
  // azar compartan el mismo número de comprobante (mismo resguardo que usa el
  // link de ETL en linkDetalleComprasByComprobante). El proveedor se filtra
  // también — ver whereLineasDeCompra.
  const compra = await prisma.compra.findUnique({
    where: { rowId: compraId },
    select: { comprobante: true, localId: true, codigo: true },
  });

  const where = whereLineasDeCompra(compra, compraId);

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
      ivaTot: true,
      impNtTot: true,
      observac: true,
    },
    orderBy: { rowId: "asc" },
  });

  return NextResponse.json({ data: lineas });
}
