import type { PrismaClient } from "@prisma/client";
import { ORIGEN_LAZARILLO, type FacturaInput } from "./armar";
import { facturaDesdeFilas } from "./leer";

// Leer una factura de la base con el formato del modal de carga (ver / editar /
// repetir). Se usa desde GET /api/facturas/[rowId] y /api/facturas/ultima.

// La factura a la que pertenece una fila de compras: todas las filas del mismo
// comprobante y proveedor en ese local (o, si es de Lazarillo, en los locales
// donde se repartió).
export async function factura(prisma: PrismaClient, rowId: string) {
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

export type FacturaLeida = {
  rowId: string; origen: "lazarillo" | "maxirest"; editable: boolean; estimado: boolean; proveedorId: number | null;
  factura: FacturaInput; totalFilas: number; cargadaPor?: string | null; cargadaEn?: Date; editadaEn?: Date;
};

export async function leerFactura(prisma: PrismaClient, rowId: string): Promise<FacturaLeida | null> {
  const fa = await factura(prisma, rowId);
  if (!fa) return null;
  const { c, esLz, cargada, locales } = fa;
  const filas = await prisma.compra.findMany({
    where: { comprobante: c.comprobante, codigo: c.codigo, localId: { in: locales }, ...(esLz ? { origen: ORIGEN_LAZARILLO } : { OR: [{ origen: null }, { NOT: { origen: ORIGEN_LAZARILLO } }] }) },
    select: { rowId: true, comprobante: true, codCga: true, fecha: true, observac: true, importe: true, importeManual: true, impInt: true, puntoDeVentaId: true, proveedorId: true },
    orderBy: { rowId: "asc" },
  });
  if (!filas.length) return null;
  const totalFilas = Math.round(filas.reduce((a, f) => a + Number(f.importeManual ?? f.importe ?? 0), 0) * 100) / 100;
  const proveedorId = c.proveedorId ?? filas.find((f) => f.proveedorId != null)?.proveedorId ?? null;

  if (cargada) {
    return {
      rowId, origen: "lazarillo", editable: true, estimado: false, proveedorId,
      totalFilas, cargadaPor: cargada.creadoPor, cargadaEn: cargada.creadoEn, editadaEn: cargada.actualizadoEn,
      factura: cargada.payload as unknown as FacturaInput,
    };
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
  return {
    rowId, origen: esLz ? "lazarillo" : "maxirest", editable: esLz && proveedorId != null, estimado: leido.estimado, proveedorId,
    factura: leido.factura, totalFilas,
  };
}
