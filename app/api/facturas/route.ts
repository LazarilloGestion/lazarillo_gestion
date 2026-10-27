import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { reaplicarReglasActivas } from "@/lib/apertura/motor";
import { prepararFactura, insertarArmado, guardarCarga, localesDe, yaExiste, registrarActividad, descripcionFactura } from "@/lib/facturas/guardar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Alta de una factura desde el Panel (Etapa 4, punto 1). Se guarda como la
// traería MaxiRest (ver lib/facturas/armar.ts) con origen 'lazarillo'.
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? user.id;

  const p = await prepararFactura(prisma, await request.json().catch(() => null));
  if ("error" in p) return NextResponse.json({ error: p.error, detalle: p.detalle }, { status: p.status });
  const { armado } = p;

  // Nunca duplicar: si el comprobante ya está (de MaxiRest o de Lazarillo) en
  // alguno de los locales de la factura, no se vuelve a cargar.
  const comprobante = armado.filas[0].comprobante;
  if (await yaExiste(prisma, localesDe(armado), comprobante, p.proveedorCodigo)) {
    return NextResponse.json({ error: "Esta factura ya está cargada" }, { status: 409 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await insertarArmado(tx, p);
      await guardarCarga(tx, p, usuario);
      await registrarActividad(tx, {
        tipo: "factura", accion: "creada", descripcion: descripcionFactura({ ...p, total: armado.total }),
        refId: armado.filas[0].rowId, localId: armado.filas[0].localId, usuario,
      });
    });
  } catch (err) {
    console.error("[facturas] alta", err);
    return NextResponse.json({ error: "No se pudo guardar la factura" }, { status: 500 });
  }

  // Reglas de apertura (por concepto / proveedor) como a cualquier compra importada;
  // las filas con reparto explícito por PDV quedan bloqueadas y no se tocan.
  const libres = armado.filas.filter((x) => !x.esBloqueado).map((x) => x.rowId);
  const apertura = await reaplicarReglasActivas(prisma, { rowIds: libres }).catch((err: unknown) => ({ reglasReaplicadas: 0, errores: [String(err)] }));
  if (apertura.errores.length) console.error("[facturas] apertura", apertura.errores);

  return NextResponse.json({ ok: true, comprobante, total: armado.total, filas: armado.filas.length, lineas: armado.lineas.length, rowId: armado.filas[0].rowId });
}
