import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireAuthUser } from "@/lib/auth/require-auth";
import { reaplicarReglasActivas } from "@/lib/apertura/motor";
import { facturaSchema, ORIGEN_LAZARILLO, type FacturaInput } from "@/lib/facturas/armar";
import { factura, leerFactura } from "@/lib/facturas/leer-db";
import {
  prepararFactura, insertarArmado, guardarCarga, localesDe, yaExiste, borrarFilas, registrarActividad, descripcionFactura, nombrePdv,
  bloquearComprobante, Duplicada, pagosDe, leerCorrecciones, reponerCorrecciones,
} from "@/lib/facturas/guardar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ rowId: string }> };

// GET — la factura con el formato del modal de carga (para verla, editarla o repetirla).
export async function GET(_req: NextRequest, { params }: Params) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { rowId } = await params;
  const leida = await leerFactura(prisma, rowId);
  return NextResponse.json(leida ?? { noEsFactura: true });
}

// PUT — editar una factura cargada en Lazarillo: se rearman sus filas (nunca se duplica).
// Las correcciones hechas a mano en Detalle se conservan en las filas que siguen.
export async function PUT(request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? user.id;
  const { rowId } = await params;
  const fa = await factura(prisma, rowId);
  if (!fa) return NextResponse.json({ error: "No existe la factura" }, { status: 404 });
  if (!fa.esLz) return NextResponse.json({ error: "Es de MaxiRest: se modifica en MaxiRest" }, { status: 403 });

  const p = await prepararFactura(prisma, await request.json().catch(() => null));
  if ("error" in p) return NextResponse.json({ error: p.error, detalle: p.detalle }, { status: p.status });
  const nuevas = localesDe(p.armado);
  const comprobante = p.armado.filas[0].comprobante;
  const antes = { comprobante: fa.c.comprobante, codigo: fa.c.codigo, locales: fa.locales };
  const filasAntes = await prisma.compra.findMany({
    where: { origen: ORIGEN_LAZARILLO, comprobante: antes.comprobante, codigo: antes.codigo, localId: { in: antes.locales } },
    select: { rowId: true },
  });
  const rowIdsNuevos = new Set(p.armado.filas.map((x) => x.rowId));
  // Con pagos imputados no se cambia el número/proveedor ni se sacan filas pagadas.
  const cambiaClave = comprobante !== antes.comprobante || p.proveedorCodigo !== antes.codigo;
  const sacadas = filasAntes.map((x) => x.rowId).filter((id) => !rowIdsNuevos.has(id));
  if ((cambiaClave && await pagosDe(prisma, antes.comprobante, antes.codigo, antes.locales, [])) ||
      (sacadas.length && await prisma.aplicacionPagoInterno.count({ where: { compraRowId: { in: sacadas } } }))) {
    return NextResponse.json({ error: "La factura tiene pagos: no se puede cambiar el número, el proveedor ni el PDV / concepto de lo pagado" }, { status: 409 });
  }
  const pdv = await nombrePdv(prisma, p.armado.filas[0].puntoDeVentaId);
  let perdidas = 0;
  try {
    await prisma.$transaction(async (tx) => {
      await bloquearComprobante(tx, comprobante, p.proveedorCodigo);
      if (await yaExiste(tx, nuevas, comprobante, p.proveedorCodigo, p.f.fecha, antes)) throw new Duplicada();
      const correcciones = await leerCorrecciones(tx, antes.comprobante, antes.codigo, antes.locales);
      await borrarFilas(tx, antes.comprobante, antes.codigo, antes.locales);
      await insertarArmado(tx, p);
      perdidas = await reponerCorrecciones(tx, correcciones, [...rowIdsNuevos]);
      await guardarCarga(tx, p, fa.cargada?.creadoPor ?? usuario);
      if (fa.cargada) {
        await tx.facturaLazarillo.updateMany({
          where: { comprobante, codigo: p.proveedorCodigo, localId: p.armado.filas[0].localId },
          data: { creadoEn: fa.cargada.creadoEn, actualizadoPor: usuario },
        });
      }
      await registrarActividad(tx, {
        tipo: "factura", accion: "editada", descripcion: descripcionFactura({ ...p, total: p.armado.total, pdv }),
        refId: p.armado.filas[0].rowId, localId: p.armado.filas[0].localId, usuario,
      });
    }, { timeout: 30_000 });
  } catch (err) {
    if (err instanceof Duplicada || (err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Ya hay otra factura con ese proveedor y número" }, { status: 409 });
    }
    console.error("[facturas] edición", err);
    return NextResponse.json({ error: "No se pudo guardar la factura" }, { status: 500 });
  }
  const libres = p.armado.filas.filter((x) => !x.esBloqueado).map((x) => x.rowId);
  const apertura = await reaplicarReglasActivas(prisma, { rowIds: libres }).catch((err: unknown) => ({ reglasReaplicadas: 0, errores: [String(err)] }));
  if (apertura.errores.length) console.error("[facturas] apertura", apertura.errores);
  return NextResponse.json({ ok: true, comprobante, total: p.armado.total, rowId: p.armado.filas[0].rowId, correccionesPerdidas: perdidas });
}

// DELETE — eliminar una factura cargada en Lazarillo (las de MaxiRest se borran en MaxiRest).
// Con pagos no se borra. Lo cargado queda en la actividad para poder restaurarla.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? user.id;
  const { rowId } = await params;
  const fa = await factura(prisma, rowId);
  if (!fa) return NextResponse.json({ error: "No existe la factura" }, { status: 404 });
  if (!fa.esLz) return NextResponse.json({ error: "Es de MaxiRest: se borra en MaxiRest" }, { status: 403 });
  const filas = await prisma.compra.findMany({
    where: { origen: ORIGEN_LAZARILLO, comprobante: fa.c.comprobante, codigo: fa.c.codigo, localId: { in: fa.locales } },
    select: { rowId: true, importe: true, puntoDeVentaId: true },
  });
  if (await pagosDe(prisma, fa.c.comprobante, fa.c.codigo, fa.locales, filas.map((x) => x.rowId))) {
    return NextResponse.json({ error: "La factura tiene pagos: primero hay que sacar los pagos" }, { status: 409 });
  }
  const total = filas.reduce((a, f) => a + Number(f.importe ?? 0), 0);
  const pdv = await nombrePdv(prisma, filas[0]?.puntoDeVentaId);
  // Lo cargado (o, para las cargadas antes del 27/10, la factura rearmada de sus filas).
  const guardado = fa.cargada?.payload as unknown as FacturaInput | undefined;
  const payload = guardado ?? (await leerFactura(prisma, rowId))?.factura;
  const f = payload && facturaSchema.safeParse(payload).success ? payload : null;
  const prov = fa.c.proveedor?.trim() || fa.c.codigo;
  const desc = f
    ? descripcionFactura({ f, nombreProv: prov, total, pdv })
    : `${prov}\n${[fa.c.comprobante, pdv, `$ ${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`].filter(Boolean).join(" · ")}`;
  await prisma.$transaction(async (tx) => {
    await borrarFilas(tx, fa.c.comprobante, fa.c.codigo, fa.locales);
    await registrarActividad(tx, { tipo: "factura", accion: "eliminada", descripcion: desc, refId: null, localId: fa.c.localId, usuario, datos: f ? { payload: f } : null });
  });
  return NextResponse.json({ ok: true, filas: filas.length });
}
