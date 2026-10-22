import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { impagasDesde, movimientosAperturaSql, type MovimientoSqlRow } from "@/lib/impagas/query";
import {
  MEDIOS_PAGO_INTERNO, imputarFifo, normalizarReferencia, redondear, saldoMov,
} from "@/lib/impagas/aperturas";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  pdvOrigenId: z.number().int().positive(),
  pdvDestinoId: z.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  medio: z.enum(MEDIOS_PAGO_INTERNO),
  referencia: z.string().max(200).optional().nullable(),
  // Pago libre: importe, se imputa a lo más viejo primero (desde el filtro "Desde").
  importe: z.number().positive().optional(),
  desde: z.string().optional(),
  // Saldar: los movimientos elegidos, cada uno por su saldo entero.
  keys: z.array(z.string().min(1)).max(10000).optional(),
}).refine((b) => (b.keys?.length ?? 0) > 0 || b.importe !== undefined, { message: "importe o keys" });

// POST: registrar un pago del PDV destino al PDV origen de las aperturas.
export async function POST(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const b = parsed.data;
  if (b.pdvOrigenId === b.pdvDestinoId) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  let referencia: string | null = null;
  if (b.medio === "Transferencia") {
    referencia = normalizarReferencia(b.referencia ?? "");
    if (!referencia) {
      return NextResponse.json({ error: "Falta el ID de la transferencia (letras y números)." }, { status: 400 });
    }
    const repetida = await prisma.pagoInterno.findUnique({ where: { referencia }, select: { id: true } });
    if (repetida) return NextResponse.json({ error: "Ese ID de transferencia ya está cargado." }, { status: 409 });
  }

  // Movimientos pendientes con este origen (todos para Saldar; desde el filtro para un pago libre).
  const desde = b.keys?.length ? "1900-01-01" : impagasDesde(b.desde, process.env.IMPAGAS_DESDE);
  const movs = (await prisma.$queryRaw<MovimientoSqlRow[]>(movimientosAperturaSql(b.pdvDestinoId, desde)))
    .filter((m) => m.pdv_origen_id === b.pdvOrigenId)
    .map((m) => ({ key: m.key, fecha: m.fecha, importe: Number(m.importe), aplicado: Number(m.aplicado) }));

  let importe: number;
  let aplicaciones: { key: string; importe: number }[];
  if (b.keys?.length) {
    const elegidos = new Set(b.keys);
    aplicaciones = movs
      .filter((m) => elegidos.has(m.key) && saldoMov(m) > 0)
      .map((m) => ({ key: m.key, importe: redondear(saldoMov(m)) }));
    importe = redondear(aplicaciones.reduce((s, a) => s + a.importe, 0));
    if (importe <= 0) return NextResponse.json({ error: "No hay saldo para saldar." }, { status: 400 });
  } else {
    importe = redondear(b.importe!);
    aplicaciones = imputarFifo(movs, importe).aplicaciones;
  }

  try {
    const pago = await prisma.pagoInterno.create({
      data: {
        pdvOrigenId: b.pdvOrigenId,
        pdvDestinoId: b.pdvDestinoId,
        fecha: new Date(`${b.fecha}T00:00:00Z`),
        importe: new Prisma.Decimal(importe),
        medio: b.medio,
        referencia,
        aplicaciones: {
          create: aplicaciones.map((a) => ({ compraRowId: a.key, importe: new Prisma.Decimal(a.importe) })),
        },
      },
      select: { id: true },
    });
    const aplicado = redondear(aplicaciones.reduce((s, a) => s + a.importe, 0));
    return NextResponse.json({ ok: true, id: pago.id, importe, aplicado, aCuenta: redondear(importe - aplicado) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Ese ID de transferencia ya está cargado." }, { status: 409 });
    }
    console.error("[POST /api/impagas/pagos-internos]", err);
    return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  }
}
