import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

function toInt(s: string | null): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isInteger(n) ? n : undefined;
}

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const anio = toInt(searchParams.get("anio"));
  const localId = toInt(searchParams.get("localId"));
  const puntoDeVentaId = toInt(searchParams.get("puntoDeVentaId"));

  if (!anio) {
    return NextResponse.json({ error: "Falta anio" }, { status: 400 });
  }

  try {
    const rows = await prisma.flujoCajaManual.findMany({
      where: {
        anio,
        ...(localId !== undefined ? { localId } : {}),
        ...(puntoDeVentaId !== undefined ? { puntoDeVentaId } : {}),
      },
      select: { localId: true, puntoDeVentaId: true, mes: true, monto: true },
    });

    const meses: Record<number, number | null> = {};
    for (let m = 1; m <= 12; m++) meses[m] = null;

    if (puntoDeVentaId !== undefined) {
      // Filtro exacto por PDV puntual: no hay ambigüedad de niveles, se suma directo.
      for (const row of rows) {
        meses[row.mes] = (meses[row.mes] ?? 0) + Number(row.monto);
      }
    } else {
      // Sin PDV específico (vista "todos los PDV" de un local, o "todos los locales"):
      // por cada local+mes, priorizar la fila "todo el local" (puntoDeVentaId null) sobre
      // la suma de PDVs — si Diego cargó a los dos niveles para el mismo mes, evita duplicar.
      const porLocalYMes = new Map<string, { local: number | null; pdv: number; mes: number }>();
      for (const row of rows) {
        const key = `${row.localId ?? "null"}:${row.mes}`;
        const entry = porLocalYMes.get(key) ?? { local: null, pdv: 0, mes: row.mes };
        if (row.puntoDeVentaId == null) {
          entry.local = (entry.local ?? 0) + Number(row.monto);
        } else {
          entry.pdv += Number(row.monto);
        }
        porLocalYMes.set(key, entry);
      }
      for (const { local, pdv, mes } of porLocalYMes.values()) {
        meses[mes] = (meses[mes] ?? 0) + (local ?? pdv);
      }
    }

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
