import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { movimientosAperturaSql, type MovimientoSqlRow } from "@/lib/impagas/query";
import { MEDIOS_PAGO_INTERNO, imputarElegidos, normalizarReferencia, redondear } from "@/lib/impagas/aperturas";

export const dynamic = "force-dynamic";

async function leerId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const patchSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  medio: z.enum(MEDIOS_PAGO_INTERNO),
  referencia: z.string().max(200).optional().nullable(),
  importe: z.number().positive(),
});

// PATCH: editar una orden de pago (fecha, medio, ID, importe). Si cambia el
// importe se vuelve a imputar: primero a los mismos movimientos, después a lo
// más viejo pendiente, y lo que no entra queda a cuenta.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const id = await leerId(params);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const b = parsed.data;

  const pago = await prisma.pagoInterno.findUnique({
    where: { id },
    include: { aplicaciones: { select: { compraRowId: true } } },
  });
  if (!pago) return NextResponse.json({ error: "Esa orden de pago ya no existe." }, { status: 404 });

  let referencia: string | null = null;
  if (b.referencia?.trim()) {
    referencia = normalizarReferencia(b.referencia);
    if (!referencia) return NextResponse.json({ error: "El ID tiene que ser de letras y números." }, { status: 400 });
    const otra = await prisma.pagoInterno.findUnique({ where: { referencia }, select: { id: true } });
    if (otra && otra.id !== id) return NextResponse.json({ error: "Ese ID de transferencia ya está cargado." }, { status: 409 });
  }

  const importe = redondear(b.importe);
  const cambiaImporte = Math.abs(importe - Number(pago.importe)) > 0.005;

  try {
    await prisma.$transaction(async (tx) => {
      if (cambiaImporte) {
        const antes = [...new Set(pago.aplicaciones.map((a) => a.compraRowId))];
        await tx.aplicacionPagoInterno.deleteMany({ where: { pagoId: id } });
        const movs = (await tx.$queryRaw<MovimientoSqlRow[]>(movimientosAperturaSql(pago.pdvDestinoId, "1900-01-01")))
          .filter((m) => m.pdv_origen_id === pago.pdvOrigenId)
          .map((m) => ({ key: m.key, fecha: m.fecha, importe: Number(m.importe), aplicado: Number(m.aplicado) }));
        // Solo a los mismos movimientos que ya tenía; lo que sobra queda a cuenta
        // (una OP sin imputar sigue sin imputar).
        const { aplicaciones } = imputarElegidos(movs, antes, importe);
        if (aplicaciones.length) {
          await tx.aplicacionPagoInterno.createMany({
            data: aplicaciones.map((a) => ({ pagoId: id, compraRowId: a.key, importe: new Prisma.Decimal(a.importe) })),
          });
        }
      }
      await tx.pagoInterno.update({
        where: { id },
        data: {
          fecha: new Date(`${b.fecha}T00:00:00Z`),
          medio: b.medio,
          referencia,
          importe: new Prisma.Decimal(importe),
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Ese ID de transferencia ya está cargado." }, { status: 409 });
    }
    console.error("[PATCH /api/impagas/pagos-internos/:id]", err);
    return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  }
}

// DELETE: eliminar una orden de pago; sus imputaciones se borran en cascada y
// los movimientos vuelven a quedar como estaban.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const id = await leerId(params);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const res = await prisma.pagoInterno.deleteMany({ where: { id } });
  if (res.count === 0) return NextResponse.json({ error: "No existe" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
