import { Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizarReferencia } from "@/lib/impagas/aperturas";
import { fmtPesos } from "@/lib/impagas/clasificar";
import { medioValido } from "@/lib/medios-pago/validar";
import { claveFactura, imputarFacturas, numeroPago } from "./imputar";
import { bloquearProveedor, referenciaRepetida, registrarEventoPago, saldosFacturas } from "./server";

// SERVIDOR. Registrar un pago a un proveedor dentro de una transacción: lo usan la
// cuenta corriente (POST /api/pagos-proveedor) y la carga de factura ("Registrar el
// pago ahora", en la MISMA transacción que la factura).

export const pagoSchema = z.object({
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
export type PagoInput = z.infer<typeof pagoSchema>;

export class RechazoPago extends Error {}

export async function registrarPago(tx: Prisma.TransactionClient, b: PagoInput, usuario: string | null) {
  await bloquearProveedor(tx, b.codPro);
  const elegidas = [...new Map((b.facturas ?? []).map((f) => [claveFactura(f.pdvId, f.comprobante), f])).values()];
  const saldos = await saldosFacturas(tx, b.codPro, elegidas);
  if ([...saldos.values()].some((s) => !s.existe)) throw new RechazoPago("Alguna factura elegida no existe.");
  const pendientes = [...saldos.values()].map((s) => ({ key: s.key, fecha: s.fecha, saldo: s.saldo }));
  if (elegidas.length && !pendientes.some((p) => p.saldo > 0.004)) throw new RechazoPago("Esas facturas ya están pagas.");

  // ── Aplicar el disponible de un pago a cuenta ──
  if (b.usarPago !== undefined) {
    const pago = await tx.pagoProveedor.findUnique({ where: { id: b.usarPago }, include: { aplicaciones: { select: { importe: true } } } });
    if (!pago || pago.anuladoEn || pago.codPro !== b.codPro) throw new RechazoPago("Ese pago ya no existe o está anulado.");
    const disp = Number(pago.importe) - pago.aplicaciones.reduce((s, a) => s + Number(a.importe), 0);
    if (disp <= 0.004) throw new RechazoPago(`${numeroPago(pago.id)} no tiene disponible.`);
    const monto = Math.min(b.importe ?? disp, disp);
    const { aplicaciones } = imputarFacturas(pendientes, monto);
    await crearAplicaciones(tx, pago.id, b.codPro, aplicaciones);
    const aplicado = aplicaciones.reduce((s, a) => s + a.importe, 0);
    await registrarEventoPago(tx, pago.id, "imputado", `${aplicaciones.length} factura${aplicaciones.length === 1 ? "" : "s"}`, aplicado, usuario);
    return { id: pago.id, aplicado, aCuenta: Math.round((disp - aplicado) * 100) / 100 };
  }

  // ── Pago nuevo ──
  if (!(await medioValido(tx, b.medio!))) throw new RechazoPago("Ese medio de pago no existe o está desactivado.");
  const pdv = await tx.puntoDeVenta.findUnique({ where: { id: b.pdvPagaId! }, select: { id: true } });
  if (!pdv) throw new RechazoPago("Elegí qué PDV paga.");
  let referencia: string | null = null;
  if (b.referencia?.trim()) {
    referencia = normalizarReferencia(b.referencia);
    if (!referencia) throw new RechazoPago("El ID tiene que ser de letras y números.");
    if (await referenciaRepetida(tx, referencia)) throw new RechazoPago("Ese ID de transferencia ya está cargado.");
  }
  const { aplicaciones, sobrante } = elegidas.length ? imputarFacturas(pendientes, b.importe) : { aplicaciones: [], sobrante: b.importe! };
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
