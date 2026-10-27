import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { normalizarReferencia } from "@/lib/impagas/aperturas";
import { fmtFecha } from "@/lib/impagas/clasificar";
import { medioValido } from "@/lib/medios-pago/validar";
import { bloquearProveedor, referenciaRepetida, registrarEventoPago } from "@/lib/pagos-proveedor/server";

export const dynamic = "force-dynamic";

async function leerId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const patchSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  medio: z.string().trim().min(1).max(40),
  referencia: z.string().max(200).optional().nullable(),
  pdvPagaId: z.number().int().positive(),
});

// PATCH: corregir fecha, medio, ID o PDV que paga (el importe no: para cambiarlo, anular y cargar de nuevo).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const id = await leerId(params);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const b = parsed.data;
  const pago = await prisma.pagoProveedor.findUnique({ where: { id } });
  if (!pago || pago.anuladoEn) return NextResponse.json({ error: "Ese pago ya no existe o está anulado." }, { status: 404 });
  if (!(await medioValido(prisma, b.medio, pago.medio))) return NextResponse.json({ error: "Ese medio de pago no existe o está desactivado." }, { status: 400 });
  let referencia: string | null = null;
  if (b.referencia?.trim()) {
    referencia = normalizarReferencia(b.referencia);
    if (!referencia) return NextResponse.json({ error: "El ID tiene que ser de letras y números." }, { status: 400 });
    if (await referenciaRepetida(prisma, referencia, id)) return NextResponse.json({ error: "Ese ID de transferencia ya está cargado." }, { status: 409 });
  }
  const cambios = [
    pago.fecha.toISOString().slice(0, 10) !== b.fecha ? `fecha ${fmtFecha(pago.fecha.toISOString().slice(0, 10))} → ${fmtFecha(b.fecha)}` : null,
    pago.medio !== b.medio ? `medio ${pago.medio} → ${b.medio}` : null,
    (pago.referencia ?? null) !== referencia ? `ID ${pago.referencia ?? "—"} → ${referencia ?? "—"}` : null,
    pago.pdvPagaId !== b.pdvPagaId ? "PDV que paga" : null,
  ].filter(Boolean).join(" · ");
  await prisma.$transaction(async (tx) => {
    await tx.pagoProveedor.update({ where: { id }, data: { fecha: new Date(`${b.fecha}T00:00:00Z`), medio: b.medio, referencia, pdvPagaId: b.pdvPagaId } });
    if (cambios) await registrarEventoPago(tx, id, "editado", cambios, null, user.email ?? null);
  });
  return NextResponse.json({ ok: true });
}

// DELETE: anular el pago. No se borra: queda en el historial y sus imputaciones se sueltan.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const id = await leerId(params);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const pago = await prisma.pagoProveedor.findUnique({ where: { id } });
  if (!pago || pago.anuladoEn) return NextResponse.json({ error: "Ese pago ya no existe o está anulado." }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await bloquearProveedor(tx, pago.codPro);
    await tx.aplicacionPagoProveedor.deleteMany({ where: { pagoId: id } });
    await tx.pagoProveedor.update({ where: { id }, data: { anuladoEn: new Date(), anuladoPor: user.email ?? null } });
    await registrarEventoPago(tx, id, "anulado", null, Number(pago.importe), user.email ?? null);
  });
  return NextResponse.json({ ok: true });
}
