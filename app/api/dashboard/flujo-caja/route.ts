import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";
import { aggregateFlujoCajaPorMes } from "@/lib/dashboard/flujo-caja-agg";

export const dynamic = "force-dynamic";

// Sin .min/.max en anio (a diferencia de putSchema más abajo): un año fuera de rango hoy
// responde 200 con los 12 meses en null en vez de 400, y mantenemos ese comportamiento acá.
const getQuerySchema = z.object({
  anio: z.coerce.number().int(),
  localId: z.coerce.number().int().optional(),
  puntoDeVentaId: z.coerce.number().int().optional(),
});

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    anio: searchParams.get("anio") ?? undefined,
    localId: searchParams.get("localId") ?? undefined,
    puntoDeVentaId: searchParams.get("puntoDeVentaId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Falta anio" }, { status: 400 });
  }
  const { anio, localId, puntoDeVentaId } = parsed.data;

  try {
    const rows = await prisma.flujoCajaManual.findMany({
      where: {
        anio,
        // un $0 es "sin dato", no ancla el cálculo — ver spec 2026-08-31
        monto: { not: 0 },
        ...(localId !== undefined ? { localId } : {}),
        ...(puntoDeVentaId !== undefined ? { puntoDeVentaId } : {}),
      },
      select: { localId: true, puntoDeVentaId: true, mes: true, monto: true },
    });

    const meses = aggregateFlujoCajaPorMes(
      rows.map((r) => ({ localId: r.localId, puntoDeVentaId: r.puntoDeVentaId, mes: r.mes, monto: Number(r.monto) })),
      puntoDeVentaId,
    );

    return NextResponse.json({ anio, meses });
  } catch (err) {
    console.error("[GET /api/dashboard/flujo-caja]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const putSchema = z.object({
  localId: z.number().int().optional(),
  puntoDeVentaId: z.number().int().optional(),
  anio: z.number().int().min(2000).max(2100),
  mes: z.number().int().min(1).max(12),
  monto: z.number(),
});

export async function PUT(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { localId, puntoDeVentaId, anio, mes, monto } = parsed.data;

  try {
    // Un monto en 0 significa "sin dato" (ver spec 2026-08-31): se borra la fila en vez de
    // guardar un $0 que después no se puede limpiar. Borrar una fila inexistente es no-op.
    // IS NOT DISTINCT FROM para matchear con localId/puntoDeVentaId en null, consistente con el
    // índice único NULLS NOT DISTINCT (migración 20260723000100).
    if (monto === 0) {
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM "flujo_caja_manual"
        WHERE "localId" IS NOT DISTINCT FROM ${localId ?? null}
          AND "puntoDeVentaId" IS NOT DISTINCT FROM ${puntoDeVentaId ?? null}
          AND "anio" = ${anio}
          AND "mes" = ${mes}
      `);
      return NextResponse.json({ ok: true });
    }

    // Prisma no permite null en el lookup de una unique key compuesta (limitación del cliente,
    // no de la DB), y acá localId/puntoDeVentaId son nullable — se resuelve con upsert nativo de
    // Postgres. El índice único subyacente es NULLS NOT DISTINCT (migración 20260723000100),
    // por eso ON CONFLICT también matchea correctamente cuando alguno de los dos es null.
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "flujo_caja_manual" ("localId", "puntoDeVentaId", "anio", "mes", "monto")
      VALUES (${localId ?? null}, ${puntoDeVentaId ?? null}, ${anio}, ${mes}, ${monto})
      ON CONFLICT ("localId", "puntoDeVentaId", "anio", "mes")
      DO UPDATE SET "monto" = EXCLUDED."monto"
    `);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[PUT /api/dashboard/flujo-caja]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
