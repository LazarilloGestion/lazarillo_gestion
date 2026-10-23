import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  impagasDesde, impagasSql, movimientosAperturaSql, pagosInternosSql,
  type ImpagaSqlRow, type MovimientoSqlRow, type PagoInternoSqlRow,
} from "@/lib/impagas/query";
import type { DeudaConPdv } from "@/lib/impagas/aperturas";
import type { ComprobanteImpago, ImpagasResponse } from "@/lib/impagas/clasificar";

export const dynamic = "force-dynamic";

// GET /api/impagas?pdvId=1&desde=2025-09-01 — comprobantes con saldo del PDV (impagas + excluidas;
// la separación por motivo la hace el modal, así "Pasar a impagas" es inmediato).
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const pdvId = Number(params.get("pdvId"));
  if (!Number.isInteger(pdvId) || pdvId <= 0) {
    return NextResponse.json({ error: "pdvId requerido" }, { status: 400 });
  }
  const desde = impagasDesde(params.get("desde"), process.env.IMPAGAS_DESDE);

  try {
    const [rows, movs, pagos] = await Promise.all([
      prisma.$queryRaw<ImpagaSqlRow[]>(impagasSql(pdvId, desde)),
      prisma.$queryRaw<MovimientoSqlRow[]>(movimientosAperturaSql(pdvId, desde)),
      prisma.$queryRaw<PagoInternoSqlRow[]>(pagosInternosSql(pdvId)),
    ]);
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
    const deudas = new Map<number, DeudaConPdv>();
    const deuda = (id: number) => {
      if (!deudas.has(id)) deudas.set(id, { pdvOrigenId: id, movimientos: [], pagos: [] });
      return deudas.get(id)!;
    };
    for (const m of movs) {
      deuda(m.pdv_origen_id).movimientos.push({
        key: m.key, fecha: m.fecha, comprobante: m.comprobante,
        proveedor: m.proveedor?.trim() || "—", concepto: m.concepto?.trim() || "",
        porcentaje: Number(m.porcentaje), importe: Number(m.importe), aplicado: Number(m.aplicado),
        esEmpleado: m.es_empleado, ops: m.ops ?? [], rubro: m.rubro?.trim() || "Sin rubro",
      });
    }
    for (const p of pagos) {
      deuda(p.pdv_origen_id).pagos.push({
        id: p.id, fecha: p.fecha, importe: Number(p.importe), medio: p.medio, referencia: p.referencia,
        aplicado: Number(p.aplicado), movimientos: Number(p.movimientos),
      });
    }
    const body: ImpagasResponse = { desde, data, deudas: [...deudas.values()] };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[GET /api/impagas]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
