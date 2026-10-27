import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { pagoSchema, registrarPago, RechazoPago } from "@/lib/pagos-proveedor/registrar";

export const dynamic = "force-dynamic";

// POST: registrar un pago a un proveedor (o aplicar un pago a cuenta a facturas).
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const parsed = pagoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const r = await prisma.$transaction((tx) => registrarPago(tx, parsed.data, user.email ?? null));
    return NextResponse.json(r, { status: 201 });
  } catch (err) {
    if (err instanceof RechazoPago) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[POST /api/pagos-proveedor]", err);
    return NextResponse.json({ error: "No se pudo registrar el pago." }, { status: 500 });
  }
}
