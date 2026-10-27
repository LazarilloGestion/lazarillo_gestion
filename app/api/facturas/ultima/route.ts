import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { leerFactura } from "@/lib/facturas/leer-db";

export const dynamic = "force-dynamic";

// GET — la última factura del proveedor en el local (de MaxiRest o de Lazarillo),
// con el formato del modal: "Precargar esa estructura" (Repetir) en la carga.
// Se salta las notas de crédito y los gastos varios.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = new URL(request.url).searchParams;
  const proveedorId = Number(sp.get("proveedorId"));
  const localId = Number(sp.get("localId"));
  if (!Number.isInteger(proveedorId) || !Number.isInteger(localId)) return NextResponse.json({ ultima: null });
  // Las últimas facturas (sin notas de crédito ni gastos varios), una fila por comprobante.
  const orden = await prisma.$queryRaw<{ rowId: string }[]>`
    SELECT MIN("rowId") AS "rowId"
    FROM compras
    WHERE "proveedorId" = ${proveedorId} AND "localId" = ${localId}
      AND comprobante IS NOT NULL AND UPPER(LEFT(comprobante, 1)) NOT IN ('N', 'E', 'G')
    GROUP BY comprobante
    ORDER BY MAX(fecha) DESC NULLS LAST
    LIMIT 3
  `;
  for (const o of orden) {
    const leida = await leerFactura(prisma, o.rowId);
    if (leida && leida.factura.registros.length) return NextResponse.json({ ultima: leida });
  }
  return NextResponse.json({ ultima: null });
}
