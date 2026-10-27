import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { reaplicarReglasActivas } from "@/lib/apertura/motor";
import { prepararFactura, insertarArmado, guardarCarga, localesDe, yaExiste, registrarActividad, descripcionFactura, nombrePdv } from "@/lib/facturas/guardar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — restaurar una factura eliminada desde la campanita: se vuelve a cargar tal
// cual estaba (lo guardado en la actividad). Nunca duplica: si ese comprobante ya
// volvió a estar (de MaxiRest o cargado de nuevo), no se restaura.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? user.id;
  const id = Number((await params).id);
  const act = Number.isInteger(id) ? await prisma.actividad.findUnique({ where: { id } }) : null;
  const datos = (act?.datos ?? null) as { payload?: unknown; restauradaEn?: string } | null;
  if (!act || act.tipo !== "factura" || act.accion !== "eliminada" || !datos?.payload) {
    return NextResponse.json({ error: "No hay nada para restaurar" }, { status: 404 });
  }
  if (datos.restauradaEn) return NextResponse.json({ error: "Ya se restauró" }, { status: 409 });

  const p = await prepararFactura(prisma, datos.payload);
  if ("error" in p) return NextResponse.json({ error: p.error, detalle: p.detalle }, { status: p.status });
  const comprobante = p.armado.filas[0].comprobante;
  if (await yaExiste(prisma, localesDe(p.armado), comprobante, p.proveedorCodigo)) {
    return NextResponse.json({ error: "Ese comprobante ya está cargado otra vez: no se restaura para no duplicarlo" }, { status: 409 });
  }
  const pdv = await nombrePdv(prisma, p.armado.filas[0].puntoDeVentaId);
  await prisma.$transaction(async (tx) => {
    await insertarArmado(tx, p);
    await guardarCarga(tx, p, usuario);
    await tx.actividad.update({ where: { id }, data: { datos: { ...datos, restauradaEn: new Date().toISOString() } as Prisma.InputJsonValue } });
    await registrarActividad(tx, {
      tipo: "factura", accion: "restaurada", descripcion: descripcionFactura({ ...p, total: p.armado.total, pdv }),
      refId: p.armado.filas[0].rowId, localId: p.armado.filas[0].localId, usuario,
    });
  });
  const libres = p.armado.filas.filter((x) => !x.esBloqueado).map((x) => x.rowId);
  await reaplicarReglasActivas(prisma, { rowIds: libres }).catch(() => null);
  return NextResponse.json({ ok: true, rowId: p.armado.filas[0].rowId, comprobante, total: p.armado.total });
}
