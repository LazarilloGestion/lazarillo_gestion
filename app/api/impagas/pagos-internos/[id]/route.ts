import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireAuthUser } from "@/lib/auth/require-auth";
import { aplicacionesOpSql, movimientosAperturaSql, type AplicacionOpSqlRow, type MovimientoSqlRow } from "@/lib/impagas/query";
import { MEDIOS_PAGO_INTERNO, imputarElegidos, normalizarReferencia, redondear } from "@/lib/impagas/aperturas";
import { fmtFecha, fmtPesos } from "@/lib/impagas/clasificar";
import { registrarEvento } from "@/lib/impagas/eventos";

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
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const id = await leerId(params);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const b = parsed.data;

  const pago = await prisma.pagoInterno.findUnique({
    where: { id },
    include: { aplicaciones: { select: { compraRowId: true } } },
  });
  if (!pago || pago.anuladoEn) return NextResponse.json({ error: "Esa orden de pago ya no existe o está anulada." }, { status: 404 });

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
      // Qué cambió, para el historial.
      const cambios: string[] = [];
      if (cambiaImporte) cambios.push(`importe ${fmtPesos(Number(pago.importe))} → ${fmtPesos(importe)}`);
      const fechaAntes = pago.fecha.toISOString().slice(0, 10);
      if (fechaAntes !== b.fecha) cambios.push(`fecha ${fmtFecha(fechaAntes)} → ${fmtFecha(b.fecha)}`);
      if (pago.medio !== b.medio) cambios.push(`medio ${pago.medio} → ${b.medio}`);
      if ((pago.referencia ?? null) !== referencia) cambios.push(referencia ? `ID ${referencia}` : "sin ID");
      await registrarEvento(tx, {
        pagoId: id, tipo: "editada", importe, usuario: user.email ?? null,
        detalle: cambios.length ? cambios.join(" · ") : "sin cambios",
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

// GET: la orden de pago con sus imputaciones (para el modal de la OP).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const id = await leerId(params);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const pago = await prisma.pagoInterno.findUnique({ where: { id } });
  if (!pago) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const aplicaciones = (await prisma.$queryRaw<AplicacionOpSqlRow[]>(aplicacionesOpSql(id))).map((a) => ({
    key: a.key, fecha: a.fecha, comprobante: a.comprobante, proveedor: a.proveedor?.trim() || "—",
    concepto: a.concepto?.trim() || "", importe: Number(a.importe),
  }));
  const aplicado = redondear(aplicaciones.reduce((s, a) => s + a.importe, 0));
  // Anterior / Siguiente: todas las órdenes del mismo par de PDV, anuladas
  // incluidas, en orden de número.
  const par = { pdvOrigenId: pago.pdvOrigenId, pdvDestinoId: pago.pdvDestinoId };
  const [anterior, siguiente] = await Promise.all([
    prisma.pagoInterno.findFirst({ where: { ...par, id: { lt: id } }, orderBy: { id: "desc" }, select: { id: true } }),
    prisma.pagoInterno.findFirst({ where: { ...par, id: { gt: id } }, orderBy: { id: "asc" }, select: { id: true } }),
  ]);
  return NextResponse.json({
    anteriorId: anterior?.id ?? null, siguienteId: siguiente?.id ?? null,
    anuladaEn: pago.anuladoEn ? pago.anuladoEn.toISOString() : null,
    id: pago.id, pdvOrigenId: pago.pdvOrigenId, pdvDestinoId: pago.pdvDestinoId,
    fecha: pago.fecha.toISOString().slice(0, 10), importe: Number(pago.importe), medio: pago.medio,
    referencia: pago.referencia, creadoPor: pago.creadoPor, creadoEn: pago.creadoEn.toISOString(),
    anulada: !!pago.anuladoEn, aplicado, disponible: pago.anuladoEn ? 0 : redondear(Number(pago.importe) - aplicado), aplicaciones,
  });
}

// DELETE: ANULAR la orden de pago. No se borra: queda marcada como anulada en el
// historial (su número no se reutiliza); sus imputaciones se quitan y los
// movimientos vuelven a quedar impagos. El ID de transferencia se libera.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const id = await leerId(params);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const pago = await prisma.pagoInterno.findUnique({ where: { id }, include: { aplicaciones: { select: { compraRowId: true } } } });
  if (!pago || pago.anuladoEn) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const n = new Set(pago.aplicaciones.map((a) => a.compraRowId)).size;
  await prisma.$transaction(async (tx) => {
    await tx.aplicacionPagoInterno.deleteMany({ where: { pagoId: id } });
    await tx.pagoInterno.update({ where: { id }, data: { anuladoEn: new Date(), referencia: null } });
    await registrarEvento(tx, {
      pagoId: id, tipo: "anulada", importe: Number(pago.importe), usuario: user.email ?? null,
      detalle: `${pago.medio}${pago.referencia ? ` · ID ${pago.referencia}` : ""} · ${n ? `tenía ${n} movimiento${n === 1 ? "" : "s"} imputado${n === 1 ? "" : "s"}` : "sin imputar"}`,
    });
  });
  return NextResponse.json({ ok: true });
}
