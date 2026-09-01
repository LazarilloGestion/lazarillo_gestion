import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const getQuerySchema = z.object({
  localId: z.coerce.number().int().optional(),
  puntoDeVentaId: z.coerce.number().int().optional(),
});

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    localId: searchParams.get("localId") ?? undefined,
    puntoDeVentaId: searchParams.get("puntoDeVentaId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }
  const { localId, puntoDeVentaId } = parsed.data;

  try {
    const primera = await prisma.flujoCajaManual.findFirst({
      where: {
        // un $0 es "sin dato", no ancla el cálculo — ver spec 2026-08-31
        monto: { not: 0 },
        ...(localId !== undefined ? { localId } : {}),
        ...(puntoDeVentaId !== undefined ? { puntoDeVentaId } : {}),
      },
      orderBy: [{ anio: "asc" }, { mes: "asc" }],
      select: { anio: true, mes: true },
    });

    return NextResponse.json({ primerArqueo: primera ? { anio: primera.anio, mes: primera.mes } : null });
  } catch (err) {
    console.error("[GET /api/dashboard/flujo-caja/primer-arqueo]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
