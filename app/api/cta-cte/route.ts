import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { impagasDesde } from "@/lib/impagas/query";
import { estadoPago } from "@/lib/cta-cte/estado";
import {
  facturasCtaCteSql, pdvsDelProveedorSql, proveedorCtaCteSql,
  type FacturaCtaCteRow, type PdvConComprasRow, type ProveedorCtaCteRow,
} from "@/lib/cta-cte/query";

export const dynamic = "force-dynamic";

// GET ?pdvId&codPro: cuenta corriente del proveedor en un PDV (solo lectura).
// Todas sus facturas del 14 (pagas incluidas) con los pagos del informe 80.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const pdvId = Number(sp.get("pdvId"));
  const codPro = (sp.get("codPro") ?? "").trim();
  if (!Number.isInteger(pdvId) || pdvId <= 0 || !codPro || codPro.length > 40) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  try {
    const [facturas, prov, pdvs] = await Promise.all([
      prisma.$queryRaw<FacturaCtaCteRow[]>(facturasCtaCteSql(pdvId, codPro)),
      prisma.$queryRaw<ProveedorCtaCteRow[]>(proveedorCtaCteSql(codPro, pdvId)),
      prisma.$queryRaw<PdvConComprasRow[]>(pdvsDelProveedorSql(codPro)),
    ]);
    const p = prov[0];
    const desde = impagasDesde(null, process.env.IMPAGAS_DESDE);
    return NextResponse.json({
      codPro,
      pdvId,
      proveedor: p?.nombre?.trim() || `Proveedor ${codPro}`,
      razon: p?.razon ?? null,
      cuit: p?.cuit ?? null,
      pagoAutomatico: !!p?.pago_automatico,
      desdeCobertura: desde,
      pdvs: pdvs.map((r) => ({ id: r.id, label: `${r.local} · ${r.pdv}`, facturas: Number(r.facturas) })),
      facturas: facturas.map((f) => {
        const total = Number(f.total), pagado = Number(f.pagado);
        return {
          comprobante: f.comprobante,
          fecha: f.fecha ?? "",
          total, pagado,
          conceptos: f.conceptos ?? "",
          rowId: f.row_id,
          solo80: f.solo80,
          estado: estadoPago({ comprobante: f.comprobante, fecha: f.fecha, total, pagado, pagoAutomatico: !!p?.pago_automatico }, desde),
          pagos: (f.pagos ?? []).map((x) => ({ fecha: x.fecha, importe: Number(x.importe), medio: x.medio, orden: x.orden })),
        };
      }),
    });
  } catch (err) {
    console.error("[GET /api/cta-cte]", err);
    return NextResponse.json({ error: "No se pudo leer la cuenta corriente." }, { status: 500 });
  }
}
