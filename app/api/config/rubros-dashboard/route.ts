import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";
import { VISIBILIDAD_FIELDS, type VisibilidadField } from "@/lib/dashboard/constants";

export const dynamic = "force-dynamic";

// Whitelist estricta: nunca derivar el nombre de columna directo de un query param sin este mapeo.
function resolveField(raw: string | null): VisibilidadField {
  return VISIBILIDAD_FIELDS.includes(raw as VisibilidadField) ? (raw as VisibilidadField) : "visibleEnDashboard";
}

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const field = resolveField(new URL(request.url).searchParams.get("field"));

  try {
    const rubros = await prisma.rubroConceptoCaja.findMany({
      select: { codigo: true, nombre: true, [field]: true },
      orderBy: { nombre: "asc" },
    });
    const visible = rubros.map((r) => ({ codigo: r.codigo, nombre: r.nombre, visible: r[field as keyof typeof r] }));
    return NextResponse.json(visible);
  } catch (err) {
    console.error("[GET /api/config/rubros-dashboard]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const patchSchema = z.object({
  codigo: z.string().min(1),
  visible: z.boolean(),
  field: z.enum(VISIBILIDAD_FIELDS).optional(),
});

export async function PATCH(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { codigo, visible, field: rawField } = parsed.data;
  const field = rawField ?? "visibleEnDashboard";

  const updated = await prisma.rubroConceptoCaja.updateMany({
    where: { codigo },
    data: { [field]: visible },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Rubro not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
