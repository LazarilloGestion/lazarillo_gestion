import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { hoyArgentina } from "@/lib/dashboard/frescura";
import { sinCargaSql, type FilaSinCarga } from "@/lib/sin-carga/query";
import { estaAtrasado, mesesObjetivo, venceEl, type ItemSinCarga, type MesSinCarga } from "@/lib/sin-carga/estado";

export const dynamic = "force-dynamic";

// GET ?pdvId — "Sin carga" (Diego, 28/10/2026): por mes (el actual y los dos anteriores),
// los gastos de todos los meses que todavía no impactan en el PDV (aperturas incluidas), y
// los descartados ("Ya no va" y "Este mes no").
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const pdvId = Number(request.nextUrl.searchParams.get("pdvId"));
  if (!Number.isInteger(pdvId) || pdvId <= 0) return NextResponse.json({ error: "Elegí un PDV" }, { status: 400 });

  try {
    const hoy = hoyArgentina();
    const objetivo = mesesObjetivo(hoy);
    const [filas, descartes] = await Promise.all([
      prisma.$queryRaw<FilaSinCarga[]>(sinCargaSql(pdvId, objetivo)),
      prisma.sinCargaDescarte.findMany({ where: { pdvId }, orderBy: { creadoEn: "desc" }, select: { id: true, clave: true, nombre: true, creadoEn: true } }),
    ]);
    const meses: MesSinCarga[] = objetivo.map((m) => ({ mes: m.slice(0, 7), items: [] }));
    for (const f of filas) {
      const vence = venceEl(f.mes, f.dia, f.vencido);
      const item: ItemSinCarga = {
        clave: f.clave,
        nombre: f.proveedor ?? f.concepto ?? f.clave,
        detalle: f.proveedor ? (f.concepto ?? "") : f.vencido ? "sueldos del período" : "gasto vario",
        rubro: f.rubro ?? "Sin Rubro",
        ultimo: Number(f.ultimo), ultimoTotal: Number(f.ultimo_total ?? f.ultimo), pdvOrigenId: f.pdv_origen ?? null,
        dia: f.dia, vencido: f.vencido,
        proveedorId: f.proveedor_id ?? null, conceptoCodigo: f.concepto_codigo ?? null,
        vence, atrasado: estaAtrasado(vence, hoy),
      };
      meses.find((x) => x.mes === f.mes)?.items.push(item);
    }
    return NextResponse.json({ hoy, meses, descartes });
  } catch (err) {
    console.error("[GET /api/sin-carga]", err);
    return NextResponse.json({ error: "No se pudo leer Sin carga." }, { status: 500 });
  }
}
