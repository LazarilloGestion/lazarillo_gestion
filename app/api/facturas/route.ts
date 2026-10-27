import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { reaplicarReglasActivas } from "@/lib/apertura/motor";
import { z } from "zod";
import { pagoSchema, registrarPago, RechazoPago } from "@/lib/pagos-proveedor/registrar";
import { prepararFactura, insertarArmado, guardarCarga, localesDe, yaExiste, registrarActividad, descripcionFactura, nombrePdv, bloquearComprobante, Duplicada } from "@/lib/facturas/guardar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Registrar el pago ahora" (Etapa 4, paso 4): el pago va en la misma transacción que
// la factura (si el pago no se puede registrar, la factura tampoco se guarda).
const pagoAhoraSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  medio: z.string().trim().min(1).max(40),
  referencia: z.string().max(200).optional().nullable(),
  pdvPagaId: z.number().int().positive(),
  importe: z.number().positive().optional(), // sin importe: salda la factura entera
});

// Alta de una factura desde el Panel (Etapa 4, punto 1). Se guarda como la
// traería MaxiRest (ver lib/facturas/armar.ts) con origen 'lazarillo'.
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? user.id;

  const body = await request.json().catch(() => null);
  const pagoAhora = body?.pago != null ? pagoAhoraSchema.safeParse(body.pago) : null;
  if (pagoAhora && !pagoAhora.success) return NextResponse.json({ error: "Datos del pago inválidos" }, { status: 400 });
  const p = await prepararFactura(prisma, body);
  if ("error" in p) return NextResponse.json({ error: p.error, detalle: p.detalle }, { status: p.status });
  const { armado } = p;

  // Nunca duplicar: si el comprobante ya está (de MaxiRest o de Lazarillo) en
  // alguno de los locales de la factura, no se vuelve a cargar. El control va dentro
  // de la transacción, con candado por comprobante (doble clic / dos personas).
  const comprobante = armado.filas[0].comprobante;
  const pdv = await nombrePdv(prisma, armado.filas[0].puntoDeVentaId);
  let pago: { id: number; aplicado: number; aCuenta: number } | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      await bloquearComprobante(tx, comprobante, p.proveedorCodigo);
      if (await yaExiste(tx, localesDe(armado), comprobante, p.proveedorCodigo, p.f.fecha)) throw new Duplicada();
      await insertarArmado(tx, p);
      await guardarCarga(tx, p, usuario);
      if (pagoAhora?.success) {
        // Una factura con registros en varios PDV es una factura por PDV en la cta cte: el pago las cubre a todas.
        const pdvs = [...new Set(armado.filas.map((x) => x.puntoDeVentaId).filter((x): x is number => x != null))];
        pago = await registrarPago(tx, pagoSchema.parse({
          codPro: p.proveedorCodigo, ...pagoAhora.data, facturas: pdvs.map((pdvId) => ({ pdvId, comprobante })),
        }), usuario);
      }
      await registrarActividad(tx, {
        tipo: "factura", accion: "creada", descripcion: descripcionFactura({ ...p, total: armado.total, pdv }),
        refId: armado.filas[0].rowId, localId: armado.filas[0].localId, usuario,
      });
    });
  } catch (err) {
    if (err instanceof RechazoPago) return NextResponse.json({ error: `No se guardó: ${err.message}` }, { status: 400 });
    if (err instanceof Duplicada || (err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Esta factura ya está cargada" }, { status: 409 });
    }
    console.error("[facturas] alta", err);
    return NextResponse.json({ error: "No se pudo guardar la factura" }, { status: 500 });
  }

  // Reglas de apertura (por concepto / proveedor) como a cualquier compra importada;
  // las filas con reparto explícito por PDV quedan bloqueadas y no se tocan.
  const libres = armado.filas.filter((x) => !x.esBloqueado).map((x) => x.rowId);
  const apertura = await reaplicarReglasActivas(prisma, { rowIds: libres }).catch((err: unknown) => ({ reglasReaplicadas: 0, errores: [String(err)] }));
  if (apertura.errores.length) console.error("[facturas] apertura", apertura.errores);

  return NextResponse.json({ ok: true, comprobante, total: armado.total, filas: armado.filas.length, lineas: armado.lineas.length, rowId: armado.filas[0].rowId, pago });
}
