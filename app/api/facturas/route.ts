import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { reaplicarReglasActivas } from "@/lib/apertura/motor";
import { RechazoPago } from "@/lib/pagos-proveedor/registrar";
import { prepararFactura, descripcionFactura, Duplicada } from "@/lib/facturas/guardar";
import { altaEnTx, pagoAhoraSchema } from "@/lib/facturas/alta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const comprobante = armado.filas[0].comprobante;

  let pago: { id: number; aplicado: number; aCuenta: number } | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      pago = await altaEnTx(tx, p, pagoAhora?.success ? pagoAhora.data : null, usuario,
        (pdv) => descripcionFactura({ ...p, total: armado.total, pdv }));
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
