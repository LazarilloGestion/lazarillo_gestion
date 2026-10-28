import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { arcaSql, sinParSql, type FilaArca, type FilaSinPar } from "@/lib/arca/query";
import { clasificar, PDV_ARCA, type ArcaConCarga } from "@/lib/arca/clasificar";
import { esNotaCredito, etiquetaTipo, tipoModal } from "@/lib/arca/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET — "Sin carga ARCA" y "Corregir" (Diego 28/10/2026): lo que ARCA dice que te facturaron
// y no está cargado, y lo cargado que no coincide con ARCA (importe, número, fecha, duplicado).
// ARCA es de la empresa (CUIT), no de un PDV: los descartes se guardan con pdvId 0 (PDV_ARCA).
const claveDe = (a: ArcaConCarga) => `${a.cuit}-${a.tipo}-${a.puntoVenta}-${a.numero}`;

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const [filas, sinPar, resumen, descartes, locales] = await Promise.all([
      prisma.$queryRaw<FilaArca[]>(arcaSql),
      prisma.$queryRaw<FilaSinPar[]>(sinParSql),
      prisma.$queryRaw<{ n: number; desde: string | null; hasta: string | null; ultima: Date | null }[]>`
        SELECT COUNT(*)::int AS n, to_char(MIN(fecha), 'YYYY-MM-DD') AS desde, to_char(MAX(fecha), 'YYYY-MM-DD') AS hasta,
               MAX("importadoEn") AS ultima FROM arca_comprobantes`,
      prisma.sinCargaDescarte.findMany({ where: { pdvId: PDV_ARCA }, orderBy: { creadoEn: "desc" }, select: { id: true, clave: true, nombre: true, creadoEn: true } }),
      prisma.local.findMany({ select: { id: true, nombre: true } }),
    ]);
    const arca: ArcaConCarga[] = filas.map((f) => ({
      key: "", cuit: f.cuit, emisor: f.emisor, tipo: f.tipo, puntoVenta: f.pv, numero: Number(f.nro), fecha: f.fecha,
      total: Number(f.total), otros: Number(f.otros), nc: esNotaCredito(f.tipo),
      proveedorId: f.proveedor_id ?? null, proveedor: f.proveedor ?? null, cargados: f.cargados ?? [],
    }));
    for (const a of arca) a.key = claveDe(a);
    const r = clasificar(arca, sinPar.map((s) => ({ cuit: s.cuit, comprobante: s.comprobante, localId: s.local_id, total: Number(s.total), fecha: s.fecha, rowId: s.row_id })));

    const fuera = new Set(descartes.map((d) => d.clave));
    const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]));
    const comp = (a: ArcaConCarga) => ({
      key: a.key, mes: a.fecha.slice(0, 7), cuit: a.cuit, emisor: a.emisor, proveedorId: a.proveedorId, proveedor: a.proveedor,
      tipo: a.tipo, etiqueta: etiquetaTipo(a.tipo), tipoModal: tipoModal(a.tipo), nc: a.nc,
      puntoVenta: a.puntoVenta, numero: a.numero, fecha: a.fecha, total: a.total,
    });
    const faltan = r.faltan.filter((a) => !fuera.has(`a:${a.key}`)).map(comp);
    const corregir = r.corregir.filter((c) => !fuera.has(`k:${c.arca.key}`)).map((c) => ({
      key: c.arca.key, motivo: c.motivo, detalle: c.detalle, arca: comp(c.arca),
      panel: { comprobante: c.panel.comprobante, localId: c.panel.localId, local: nombreLocal.get(c.panel.localId) ?? null, rowId: c.panel.rowId, total: c.panel.total, fecha: c.panel.fecha },
      dif: Math.round(Math.abs(c.arca.total - Math.abs(c.panel.total))),
    })).sort((x, y) => y.dif - x.dif); // las diferencias grandes, arriba
    const s = resumen[0];
    return NextResponse.json({
      importado: s && s.n ? { n: s.n, desde: s.desde, hasta: s.hasta, ultima: s.ultima } : null,
      ok: r.ok, faltan, corregir, descartes,
    });
  } catch (err) {
    console.error("[GET /api/arca/cruce]", err);
    return NextResponse.json({ error: "No se pudo cruzar con ARCA." }, { status: 500 });
  }
}
