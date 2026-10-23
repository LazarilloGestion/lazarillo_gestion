import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  fechasOrdenMaxirestSql, pagoMaxirestSql, type FechaOrdenSqlRow, type PagoMaxirestSqlRow,
} from "@/lib/impagas/query";

export const dynamic = "force-dynamic";

// GET ?pdvId&orden&fecha: un pago de MaxiRest (informe 80), solo lectura.
// Devuelve los comprobantes que cubrió ese día y las otras fechas en que se
// usó la misma orden (para Anterior / Siguiente).
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const pdvId = Number(sp.get("pdvId"));
  const orden = (sp.get("orden") ?? "").trim();
  const fecha = sp.get("fecha") ?? "";
  if (!Number.isInteger(pdvId) || pdvId <= 0 || !orden || orden.length > 40 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  const [rows, fechas] = await Promise.all([
    prisma.$queryRaw<PagoMaxirestSqlRow[]>(pagoMaxirestSql(pdvId, orden, fecha)),
    prisma.$queryRaw<FechaOrdenSqlRow[]>(fechasOrdenMaxirestSql(pdvId, orden)),
  ]);
  if (!rows.length) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const comprobantes = rows.map((r) => ({
    comprobante: r.comprobante, fecha: r.fecha, proveedor: r.proveedor?.trim() || "—",
    concepto: r.concepto?.trim() || "", total: r.total == null ? null : Number(r.total), importe: Number(r.importe),
  }));
  return NextResponse.json({
    orden, fecha,
    medios: [...new Set(rows.map((r) => r.medio).filter(Boolean))],
    importe: Math.round(comprobantes.reduce((s, c) => s + c.importe, 0) * 100) / 100,
    comprobantes,
    fechas: fechas.map((f) => ({ fecha: f.fecha, importe: Number(f.importe), comprobantes: Number(f.comprobantes) })),
  });
}
