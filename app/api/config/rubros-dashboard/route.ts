import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const rubros = await prisma.rubroConceptoCaja.findMany({
      select: { codigo: true, nombre: true, visibleEnDashboard: true },
      orderBy: { nombre: "asc" },
    });
    return NextResponse.json(rubros);
  } catch (err) {
    console.error("[GET /api/config/rubros-dashboard]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const patchSchema = z.object({
  codigo: z.string().min(1),
  visibleEnDashboard: z.boolean(),
});

export async function PATCH(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { codigo, visibleEnDashboard } = parsed.data;

  const updated = await prisma.rubroConceptoCaja.updateMany({
    where: { codigo },
    data: { visibleEnDashboard },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Rubro not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
