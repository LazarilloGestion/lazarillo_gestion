import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";
import { SIN_RUBRO_CODE, VISIBILIDAD_FIELDS, type VisibilidadField } from "@/lib/dashboard/constants";
import { agregarSinRubro, resolverVisibilidadSinRubro } from "@/lib/dashboard/sin-rubro-config";

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
    const [rubros, sinRubro] = await Promise.all([
      prisma.rubroConceptoCaja.findMany({
        select: { codigo: true, nombre: true, visibleEnDashboard: true, visibleEnResultados: true },
        orderBy: { nombre: "asc" },
      }),
      prisma.sinRubroConfig.findUnique({ where: { id: 1 } }),
    ]);
    const visible = rubros.map((r) => ({ codigo: r.codigo, nombre: r.nombre, visible: r[field] }));
    return NextResponse.json(agregarSinRubro(visible, resolverVisibilidadSinRubro(sinRubro, field)));
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

  // "Sin Rubro" es sintético: no hay fila en rubros_concepto_caja que actualizar, su flag vive en
  // sin_rubro_config. upsert para no depender de que la fila inicial exista.
  if (codigo === SIN_RUBRO_CODE) {
    await prisma.sinRubroConfig.upsert({
      where: { id: 1 },
      create: { id: 1, [field]: visible },
      update: { [field]: visible },
    });
    return NextResponse.json({ ok: true });
  }

  const updated = await prisma.rubroConceptoCaja.updateMany({
    where: { codigo },
    data: { [field]: visible },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Rubro not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
