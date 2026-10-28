import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { pagoSchema, registrarPago } from "@/lib/pagos-proveedor/registrar";
import { insertarArmado, guardarCarga, localesDe, yaExiste, registrarActividad, nombrePdv, bloquearComprobante, Duplicada, type Preparada } from "./guardar";

// SERVIDOR. Alta de una factura de Lazarillo dentro de una transacción: la usan la
// carga de factura (POST /api/facturas) y Gastos Varios (POST /api/gastos-varios).

// "Registrar el pago ahora" (Etapa 4, paso 4): el pago va en la misma transacción que
// la factura (si el pago no se puede registrar, la factura tampoco se guarda).
export const pagoAhoraSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  medio: z.string().trim().min(1).max(40),
  referencia: z.string().max(200).optional().nullable(),
  pdvPagaId: z.number().int().positive(),
  importe: z.number().positive().optional(), // sin importe: salda la factura entera
});
export type PagoAhora = z.infer<typeof pagoAhoraSchema>;

export async function altaEnTx(
  tx: Prisma.TransactionClient,
  p: Preparada,
  pagoAhora: PagoAhora | null,
  usuario: string | null,
  descripcion: (pdv: string | null) => string,
) {
  const { armado } = p;
  // Nunca duplicar: si el comprobante ya está (de MaxiRest o de Lazarillo) en
  // alguno de los locales de la factura, no se vuelve a cargar. El control va dentro
  // de la transacción, con candado por comprobante (doble clic / dos personas).
  const comprobante = armado.filas[0].comprobante;
  await bloquearComprobante(tx, comprobante, p.proveedorCodigo);
  if (await yaExiste(tx, localesDe(armado), comprobante, p.proveedorCodigo, p.f.fecha)) throw new Duplicada();
  await insertarArmado(tx, p);
  await guardarCarga(tx, p, usuario);
  let pago: { id: number; aplicado: number; aCuenta: number } | null = null;
  if (pagoAhora) {
    // Una factura con registros en varios PDV es una factura por PDV en la cta cte: el pago las cubre a todas.
    const pdvs = [...new Set(armado.filas.map((x) => x.puntoDeVentaId).filter((x): x is number => x != null))];
    pago = await registrarPago(tx, pagoSchema.parse({
      codPro: p.proveedorCodigo, ...pagoAhora, facturas: pdvs.map((pdvId) => ({ pdvId, comprobante })),
    }), usuario);
  }
  const pdv = await nombrePdv(tx, armado.filas[0].puntoDeVentaId);
  await registrarActividad(tx, {
    tipo: "factura", accion: "creada", descripcion: descripcion(pdv),
    refId: armado.filas[0].rowId, localId: armado.filas[0].localId, usuario,
  });
  return pago;
}
