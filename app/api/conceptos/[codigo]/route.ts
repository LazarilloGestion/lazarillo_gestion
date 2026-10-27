import { NextRequest, NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/prisma";
import { conceptoPropioSchema, esPropio } from "@/lib/conceptos/abm";

export const runtime = "nodejs";

// Solo los conceptos propios de Lazarillo (código >= 1000) se modifican o se
// dan de baja desde el Panel; los de MaxiRest se tocan en MaxiRest (Diego, 26/10/2026).
function codigoPropio(raw: string): string | null {
  const n = Number(raw);
  return Number.isInteger(n) && esPropio(n) ? String(n) : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ codigo: string }> }) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const codigo = codigoPropio((await params).codigo);
  if (!codigo) return NextResponse.json({ error: "Solo se modifican los conceptos de Lazarillo (desde 1000)" }, { status: 403 });
  const parsed = conceptoPropioSchema.omit({ codigo: true }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 422 });
  const d = parsed.data;
  const rubro = await prisma.rubroConceptoCaja.findUnique({ where: { codigo: d.codRubro }, select: { codigo: true } });
  if (!rubro) return NextResponse.json({ error: "El rubro no existe" }, { status: 422 });
  const r = await prisma.conceptoCaja.updateMany({ where: { codigo }, data: { nombre: d.nombre, tipo: d.tipo, codRga: d.codRubro, ...(d.imputacion !== undefined ? { codImp: d.imputacion || null } : {}) } });
  if (r.count === 0) return NextResponse.json({ error: "No existe" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ codigo: string }> }) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const codigo = codigoPropio((await params).codigo);
  if (!codigo) return NextResponse.json({ error: "Solo se dan de baja los conceptos de Lazarillo (desde 1000)" }, { status: 403 });
  const [usos, lineas] = await Promise.all([
    prisma.compra.count({ where: { OR: [{ codCga: codigo }, { conceptoCodigo: codigo }, { conceptoCodigoManual: codigo }] } }),
    prisma.detalleCompra.count({ where: { codCga: codigo } }),
  ]);
  if (usos + lineas > 0) return NextResponse.json({ error: `Tiene ${usos + lineas} registro${usos + lineas === 1 ? "" : "s"}: no se puede dar de baja` }, { status: 409 });
  // Sus reglas de apertura (p. ej. copiadas del padrino) no quedan vivas sin concepto.
  await prisma.$transaction([
    prisma.reglaApertura.updateMany({ where: { nivel: "concepto", entidadId: codigo, estado: "activa" }, data: { estado: "inactiva" } }),
    prisma.conceptoCaja.deleteMany({ where: { codigo } }),
  ]);
  return NextResponse.json({ ok: true });
}
