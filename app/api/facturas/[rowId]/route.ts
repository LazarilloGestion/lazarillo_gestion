import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireAuthUser } from "@/lib/auth/require-auth";
import { reaplicarReglasActivas } from "@/lib/apertura/motor";
import { facturaSchema, ORIGEN_LAZARILLO, type FacturaInput } from "@/lib/facturas/armar";
import { facturaDesdeFilas } from "@/lib/facturas/leer";
import {
  prepararFactura, insertarArmado, guardarCarga, localesDe, yaExiste, borrarFilas, registrarActividad, descripcionFactura,
} from "@/lib/facturas/guardar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ rowId: string }> };

// La factura a la que pertenece una fila de compras: todas las filas del mismo
// comprobante y proveedor en ese local (o, si es de Lazarillo, en los locales
// donde se repartió).
async function factura(rowId: string) {
  const c = await prisma.compra.findUnique({
    where: { rowId },
    select: { comprobante: true, codigo: true, localId: true, proveedorId: true, origen: true, proveedor: true },
  });
  if (!c || !c.comprobante || !c.codigo || c.localId == null) return null;
  const esLz = c.origen === ORIGEN_LAZARILLO;
  const cargada = esLz
    ? await prisma.facturaLazarillo.findFirst({ where: { comprobante: c.comprobante, codigo: c.codigo } })
    : null;
  const pdvs = await prisma.puntoDeVenta.findMany({ select: { id: true, localId: true } });
  const localDe = new Map(pdvs.map((p) => [p.id, p.localId]));
  let locales = [c.localId];
  if (cargada) {
    const f = cargada.payload as unknown as FacturaInput;
    const ids = f.registros.flatMap((r) => [r.puntoDeVentaId, ...(r.reparto ?? []).map((x) => x.puntoDeVentaId)]);
    locales = [...new Set([c.localId, ...ids.map((id) => localDe.get(id)).filter((x): x is number => x != null)])];
  }
  return { c: { ...c, comprobante: c.comprobante, codigo: c.codigo, localId: c.localId }, esLz, cargada, locales };
}

// GET — la factura con el formato del modal de carga (para verla o editarla).
export async function GET(_req: NextRequest, { params }: Params) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { rowId } = await params;
  const fa = await factura(rowId);
  if (!fa) return NextResponse.json({ noEsFactura: true });
  const { c, esLz, cargada, locales } = fa;
  const filas = await prisma.compra.findMany({
    where: { comprobante: c.comprobante, codigo: c.codigo, localId: { in: locales }, ...(esLz ? { origen: ORIGEN_LAZARILLO } : { OR: [{ origen: null }, { NOT: { origen: ORIGEN_LAZARILLO } }] }) },
    select: { rowId: true, comprobante: true, codCga: true, fecha: true, observac: true, importe: true, importeManual: true, impInt: true, puntoDeVentaId: true, proveedorId: true },
    orderBy: { rowId: "asc" },
  });
  if (!filas.length) return NextResponse.json({ noEsFactura: true });
  const totalFilas = Math.round(filas.reduce((a, f) => a + Number(f.importeManual ?? f.importe ?? 0), 0) * 100) / 100;
  const proveedorId = c.proveedorId ?? filas.find((f) => f.proveedorId != null)?.proveedorId ?? null;

  if (cargada) {
    return NextResponse.json({
      rowId, origen: "lazarillo", editable: true, estimado: false, proveedorId,
      factura: cargada.payload, totalFilas, cargadaPor: cargada.creadoPor, cargadaEn: cargada.creadoEn, editadaEn: cargada.actualizadoEn,
    });
  }
  const lineas = await prisma.detalleCompra.findMany({
    where: { comprobante: c.comprobante, codPro: c.codigo, localId: { in: locales }, ...(esLz ? { origen: ORIGEN_LAZARILLO } : {}) },
    select: { codigo: true, nombre: true, medida: true, cantidad: true, totalIns: true, tasa: true, impNtTot: true, codCga: true, compraId: true },
    orderBy: { rowId: "asc" },
  });
  const n = (v: unknown) => (v == null ? null : Number(v));
  const leido = facturaDesdeFilas(
    proveedorId ?? 0,
    filas.map((f) => ({ rowId: f.rowId, comprobante: f.comprobante!, codCga: f.codCga, fecha: f.fecha, observac: f.observac, importe: Number(f.importe ?? 0), impInt: Number(f.impInt ?? 0), puntoDeVentaId: f.puntoDeVentaId })),
    lineas.map((l) => ({ ...l, cantidad: n(l.cantidad), totalIns: n(l.totalIns), tasa: n(l.tasa), impNtTot: n(l.impNtTot) })),
  );
  return NextResponse.json({
    rowId, origen: esLz ? "lazarillo" : "maxirest", editable: esLz && proveedorId != null, estimado: leido.estimado, proveedorId,
    factura: leido.factura, totalFilas,
  });
}

// PUT — editar una factura cargada en Lazarillo: se rearman sus filas (nunca se duplica).
export async function PUT(request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? user.id;
  const { rowId } = await params;
  const fa = await factura(rowId);
  if (!fa) return NextResponse.json({ error: "No existe la factura" }, { status: 404 });
  if (!fa.esLz) return NextResponse.json({ error: "Es de MaxiRest: se modifica en MaxiRest" }, { status: 403 });

  const p = await prepararFactura(prisma, await request.json().catch(() => null));
  if ("error" in p) return NextResponse.json({ error: p.error, detalle: p.detalle }, { status: p.status });
  const nuevas = localesDe(p.armado);
  const comprobante = p.armado.filas[0].comprobante;
  const antes = { comprobante: fa.c.comprobante, codigo: fa.c.codigo, locales: fa.locales };
  if (await yaExiste(prisma, nuevas, comprobante, p.proveedorCodigo, antes)) {
    return NextResponse.json({ error: "Ya hay otra factura con ese proveedor y número" }, { status: 409 });
  }
  try {
    await prisma.$transaction(async (tx) => {
      await borrarFilas(tx, antes.comprobante, antes.codigo, antes.locales);
      await insertarArmado(tx, p);
      await guardarCarga(tx, p, fa.cargada?.creadoPor ?? usuario);
      if (fa.cargada) {
        await tx.facturaLazarillo.updateMany({
          where: { comprobante, codigo: p.proveedorCodigo, localId: p.armado.filas[0].localId },
          data: { creadoEn: fa.cargada.creadoEn, actualizadoPor: usuario },
        });
      }
      await registrarActividad(tx, {
        tipo: "factura", accion: "editada", descripcion: descripcionFactura({ ...p, total: p.armado.total }),
        refId: p.armado.filas[0].rowId, localId: p.armado.filas[0].localId, usuario,
      });
    }, { timeout: 30_000 });
  } catch (err) {
    console.error("[facturas] edición", err);
    return NextResponse.json({ error: "No se pudo guardar la factura" }, { status: 500 });
  }
  const libres = p.armado.filas.filter((x) => !x.esBloqueado).map((x) => x.rowId);
  const apertura = await reaplicarReglasActivas(prisma, { rowIds: libres }).catch((err: unknown) => ({ reglasReaplicadas: 0, errores: [String(err)] }));
  if (apertura.errores.length) console.error("[facturas] apertura", apertura.errores);
  return NextResponse.json({ ok: true, comprobante, total: p.armado.total, rowId: p.armado.filas[0].rowId });
}

// DELETE — eliminar una factura cargada en Lazarillo (las de MaxiRest se borran en MaxiRest).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? user.id;
  const { rowId } = await params;
  const fa = await factura(rowId);
  if (!fa) return NextResponse.json({ error: "No existe la factura" }, { status: 404 });
  if (!fa.esLz) return NextResponse.json({ error: "Es de MaxiRest: se borra en MaxiRest" }, { status: 403 });
  const filas = await prisma.compra.findMany({
    where: { origen: ORIGEN_LAZARILLO, comprobante: fa.c.comprobante, codigo: fa.c.codigo, localId: { in: fa.locales } },
    select: { importe: true, fecha: true },
  });
  const total = filas.reduce((a, f) => a + Number(f.importe ?? 0), 0);
  const payload = fa.cargada?.payload as unknown as FacturaInput | undefined;
  const f = payload && facturaSchema.safeParse(payload).success ? payload : null;
  const desc = f
    ? descripcionFactura({ f, nombreProv: fa.c.proveedor ?? fa.c.codigo, total })
    : `${fa.c.comprobante} · ${fa.c.proveedor ?? fa.c.codigo} · $ ${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
  await prisma.$transaction(async (tx) => {
    await borrarFilas(tx, fa.c.comprobante, fa.c.codigo, fa.locales);
    await registrarActividad(tx, { tipo: "factura", accion: "eliminada", descripcion: desc, refId: null, localId: fa.c.localId, usuario, datos: payload ?? null });
  });
  return NextResponse.json({ ok: true, filas: filas.length });
}
