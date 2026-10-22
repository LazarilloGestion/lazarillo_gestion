import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { impagasDesde, impagasSql, type ImpagaSqlRow } from "@/lib/impagas/query";
import type { ComprobanteImpago, ImpagasResponse } from "@/lib/impagas/clasificar";

export const dynamic = "force-dynamic";

// GET /api/impagas?pdvId=1 — comprobantes con saldo del PDV (impagas + excluidas;
// la separación por motivo la hace el modal, así "Pasar a impagas" es inmediato).
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const pdvId = Number(new URL(request.url).searchParams.get("pdvId"));
  if (!Number.isInteger(pdvId) || pdvId <= 0) {
    return NextResponse.json({ error: "pdvId requerido" }, { status: 400 });
  }
  const desde = impagasDesde(process.env.IMPAGAS_DESDE);

  try {
    const rows = await prisma.$queryRaw<ImpagaSqlRow[]>(impagasSql(pdvId, desde));
    const data: ComprobanteImpago[] = rows.map((r) => ({
      id: `${pdvId}|${r.comprobante}|${r.cod_pro}`,
      pdvId,
      comprobante: r.comprobante,
      codPro: r.cod_pro,
      proveedor: r.proveedor?.trim() || `Proveedor ${r.cod_pro}`,
      proveedorId: r.proveedor_id,
      fecha: r.fecha,
      total: Number(r.total),
      pagado: Number(r.pagado),
      rubroOculto: r.rubro_oculto,
      pagoAutomatico: r.pago_automatico,
      forzada: r.forzada,
      conceptos: r.conceptos ?? "",
      pagos: r.pagos ?? [],
    }));
    const body: ImpagasResponse = { desde, data };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[GET /api/impagas]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
