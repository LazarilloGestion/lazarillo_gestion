import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { impagasDesde, movimientosAperturaSql, type MovimientoSqlRow } from "@/lib/impagas/query";
import {
  MEDIOS_PAGO_INTERNO, imputarElegidos, imputarFifo, normalizarReferencia, numeroOP, redondear,
} from "@/lib/impagas/aperturas";
import { fmtPesos } from "@/lib/impagas/clasificar";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  pdvOrigenId: z.number().int().positive(),
  pdvDestinoId: z.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  medio: z.enum(MEDIOS_PAGO_INTERNO).optional(),
  referencia: z.string().max(200).optional().nullable(),
  // Pago libre (sin keys): importe; queda como OP sin imputar (todo a cuenta).
  importe: z.number().positive().optional(),
  desde: z.string().optional(),
  // Movimientos elegidos (un mes, un empleado o una selección): sin importe se
  // salda cada uno entero; con importe se imputa del más viejo al más nuevo y
  // el excedente queda a cuenta.
  keys: z.array(z.string().min(1)).max(10000).optional(),
  // Usar el disponible de una orden de pago existente en vez de crear otra.
  usarOp: z.number().int().positive().optional(),
})
  .refine((b) => (b.keys?.length ?? 0) > 0 || b.importe !== undefined, { message: "importe o keys" })
  .refine((b) => b.usarOp !== undefined || b.medio !== undefined, { message: "medio" });

// POST: registrar un pago del PDV destino al PDV origen de las aperturas.
export async function POST(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const b = parsed.data;
  if (b.pdvOrigenId === b.pdvDestinoId) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  if (b.usarOp !== undefined) return imputarConOp(b);

  // ID de la operación: opcional (Transferencia o Bancos); si viene, alfanumérico y sin repetir.
  let referencia: string | null = null;
  if (b.referencia?.trim()) {
    referencia = normalizarReferencia(b.referencia);
    if (!referencia) {
      return NextResponse.json({ error: "El ID tiene que ser de letras y números." }, { status: 400 });
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
  if (b.keys?.length && b.importe === undefined) {
    aplicaciones = imputarElegidos(movs, b.keys).aplicaciones;
    importe = redondear(aplicaciones.reduce((s, a) => s + a.importe, 0));
    if (importe <= 0) return NextResponse.json({ error: "No hay saldo para saldar." }, { status: 400 });
  } else if (b.keys?.length) {
    importe = redondear(b.importe!);
    aplicaciones = imputarElegidos(movs, b.keys, importe).aplicaciones;
  } else {
    // Pago sin selección: queda como orden de pago SIN IMPUTAR (todo a cuenta);
    // después se imputa eligiendo movimientos y usando la OP como medio.
    importe = redondear(b.importe!);
    aplicaciones = [];
  }

  try {
    const pago = await prisma.pagoInterno.create({
      data: {
        pdvOrigenId: b.pdvOrigenId,
        pdvDestinoId: b.pdvDestinoId,
        fecha: new Date(`${b.fecha}T00:00:00Z`),
        importe: new Prisma.Decimal(importe),
        medio: b.medio!,
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

// Imputar el disponible (lo que quedó a cuenta) de una orden de pago existente
// a movimientos: no crea una OP nueva, suma imputaciones a esa misma.
async function imputarConOp(b: z.infer<typeof bodySchema>) {
  const pago = await prisma.pagoInterno.findUnique({
    where: { id: b.usarOp! },
    include: { aplicaciones: { select: { importe: true } } },
  });
  if (!pago || pago.pdvOrigenId !== b.pdvOrigenId || pago.pdvDestinoId !== b.pdvDestinoId) {
    return NextResponse.json({ error: "Esa orden de pago no corresponde a este PDV." }, { status: 404 });
  }
  const disponible = redondear(Number(pago.importe) - pago.aplicaciones.reduce((s, a) => s + Number(a.importe), 0));
  if (disponible <= 0.005) return NextResponse.json({ error: `${numeroOP(pago.id)} no tiene saldo disponible.` }, { status: 400 });
  if (b.importe !== undefined && redondear(b.importe) > disponible + 0.005) {
    return NextResponse.json({ error: `${numeroOP(pago.id)} tiene ${fmtPesos(disponible)} disponibles.` }, { status: 400 });
  }

  const desde = b.keys?.length ? "1900-01-01" : impagasDesde(b.desde, process.env.IMPAGAS_DESDE);
  const movs = (await prisma.$queryRaw<MovimientoSqlRow[]>(movimientosAperturaSql(b.pdvDestinoId, desde)))
    .filter((m) => m.pdv_origen_id === b.pdvOrigenId)
    .map((m) => ({ key: m.key, fecha: m.fecha, importe: Number(m.importe), aplicado: Number(m.aplicado) }));

  // Saldar con la OP: si no alcanza, salda lo que da (lo más viejo primero).
  const monto = redondear(Math.min(b.importe ?? disponible, disponible));
  const { aplicaciones } = b.keys?.length ? imputarElegidos(movs, b.keys, monto) : imputarFifo(movs, monto);
  const aplicado = redondear(aplicaciones.reduce((s, a) => s + a.importe, 0));
  if (aplicado <= 0) return NextResponse.json({ error: "No hay saldo para imputar." }, { status: 400 });

  try {
    await prisma.aplicacionPagoInterno.createMany({
      data: aplicaciones.map((a) => ({ pagoId: pago.id, compraRowId: a.key, importe: new Prisma.Decimal(a.importe) })),
    });
    return NextResponse.json({ ok: true, id: pago.id, usada: true, aplicado, disponible: redondear(disponible - aplicado) });
  } catch (err) {
    console.error("[POST /api/impagas/pagos-internos usarOp]", err);
    return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  }
}
