import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { normalizarReferencia } from "@/lib/impagas/aperturas";
import { fmtPesos } from "@/lib/impagas/clasificar";
import { medioValido } from "@/lib/medios-pago/validar";
import { claveFactura, imputarFacturas, numeroPago } from "@/lib/pagos-proveedor/imputar";
import { bloquearProveedor, referenciaRepetida, registrarEventoPago, saldosFacturas } from "@/lib/pagos-proveedor/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  codPro: z.string().trim().min(1).max(40),
  pdvPagaId: z.number().int().positive().optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  medio: z.string().trim().min(1).max(40).optional(),
  referencia: z.string().max(200).optional().nullable(),
  // Sin facturas: pago a cuenta. Con facturas y sin importe: salda cada una entera.
  importe: z.number().positive().optional(),
  facturas: z.array(z.object({ pdvId: z.number().int().positive(), comprobante: z.string().trim().min(1).max(40) })).max(500).optional(),
  // Usar el disponible de un pago a cuenta existente (no crea otro pago).
  usarPago: z.number().int().positive().optional(),
})
  .refine((b) => (b.facturas?.length ?? 0) > 0 || b.importe !== undefined, { message: "importe o facturas" })
  .refine((b) => b.usarPago !== undefined || (b.medio !== undefined && b.fecha !== undefined && b.pdvPagaId !== undefined), { message: "medio, fecha y PDV" });

class Rechazo extends Error {}

// POST: registrar un pago a un proveedor (o aplicar un pago a cuenta a facturas).
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? null;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const b = parsed.data;
  const elegidas = [...new Map((b.facturas ?? []).map((f) => [claveFactura(f.pdvId, f.comprobante), f])).values()];

  try {
    const r = await prisma.$transaction(async (tx) => {
      await bloquearProveedor(tx, b.codPro);
      const saldos = await saldosFacturas(tx, b.codPro, elegidas);
      if ([...saldos.values()].some((s) => !s.existe)) throw new Rechazo("Alguna factura elegida no existe.");
      const pendientes = [...saldos.values()].map((s) => ({ key: s.key, fecha: s.fecha, saldo: s.saldo }));
      if (elegidas.length && !pendientes.some((p) => p.saldo > 0.004)) throw new Rechazo("Esas facturas ya están pagas.");

      // ── Aplicar el disponible de un pago a cuenta ──
      if (b.usarPago !== undefined) {
        const pago = await tx.pagoProveedor.findUnique({ where: { id: b.usarPago }, include: { aplicaciones: { select: { importe: true } } } });
        if (!pago || pago.anuladoEn || pago.codPro !== b.codPro) throw new Rechazo("Ese pago ya no existe o está anulado.");
        const disp = Number(pago.importe) - pago.aplicaciones.reduce((s, a) => s + Number(a.importe), 0);
        if (disp <= 0.004) throw new Rechazo(`${numeroPago(pago.id)} no tiene disponible.`);
        const monto = Math.min(b.importe ?? disp, disp);
        const { aplicaciones } = imputarFacturas(pendientes, monto);
        await crearAplicaciones(tx, pago.id, b.codPro, aplicaciones);
        const aplicado = aplicaciones.reduce((s, a) => s + a.importe, 0);
        await registrarEventoPago(tx, pago.id, "imputado", `${aplicaciones.length} factura${aplicaciones.length === 1 ? "" : "s"}`, aplicado, usuario);
        return { id: pago.id, aplicado, aCuenta: Math.round((disp - aplicado) * 100) / 100 };
      }

      // ── Pago nuevo ──
      if (!(await medioValido(tx, b.medio!))) throw new Rechazo("Ese medio de pago no existe o está desactivado.");
      const pdv = await tx.puntoDeVenta.findUnique({ where: { id: b.pdvPagaId! }, select: { id: true } });
      if (!pdv) throw new Rechazo("Elegí qué PDV paga.");
      let referencia: string | null = null;
      if (b.referencia?.trim()) {
        referencia = normalizarReferencia(b.referencia);
        if (!referencia) throw new Rechazo("El ID tiene que ser de letras y números.");
        if (await referenciaRepetida(tx, referencia)) throw new Rechazo("Ese ID de transferencia ya está cargado.");
      }
      const { aplicaciones, sobrante } = elegidas.length
        ? imputarFacturas(pendientes, b.importe)
        : { aplicaciones: [], sobrante: b.importe! };
      const importe = Math.round((aplicaciones.reduce((s, a) => s + a.importe, 0) + sobrante) * 100) / 100;
      const pago = await tx.pagoProveedor.create({
        data: {
          codPro: b.codPro, pdvPagaId: b.pdvPagaId!, fecha: new Date(`${b.fecha}T00:00:00Z`),
          importe: new Prisma.Decimal(importe), medio: b.medio!, referencia, creadoPor: usuario,
        },
      });
      await crearAplicaciones(tx, pago.id, b.codPro, aplicaciones);
      await registrarEventoPago(tx, pago.id, "creado",
        aplicaciones.length ? `${aplicaciones.length} factura${aplicaciones.length === 1 ? "" : "s"}${sobrante > 0.004 ? ` · ${fmtPesos(sobrante)} a cuenta` : ""}` : "a cuenta",
        importe, usuario);
      return { id: pago.id, aplicado: importe - sobrante, aCuenta: sobrante };
    });
    return NextResponse.json(r, { status: 201 });
  } catch (err) {
    if (err instanceof Rechazo) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[POST /api/pagos-proveedor]", err);
    return NextResponse.json({ error: "No se pudo registrar el pago." }, { status: 500 });
  }
}

async function crearAplicaciones(tx: Prisma.TransactionClient, pagoId: number, codPro: string, aplicaciones: { key: string; importe: number }[]) {
  if (!aplicaciones.length) return;
  await tx.aplicacionPagoProveedor.createMany({
    data: aplicaciones.map((a) => {
      const i = a.key.indexOf("|");
      return { pagoId, codPro, pdvId: Number(a.key.slice(0, i)), comprobante: a.key.slice(i + 1), importe: new Prisma.Decimal(a.importe) };
    }),
  });
}
