import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { impagasDesde } from "@/lib/impagas/query";
import { estadoPago } from "@/lib/cta-cte/estado";
import {
  facturasCtaCteSql, proveedorCtaCteSql, type FacturaCtaCteRow, type ProveedorCtaCteRow,
} from "@/lib/cta-cte/query";

export const dynamic = "force-dynamic";

// GET ?codPro: cuenta corriente del proveedor (solo lectura). Todas sus
// facturas del 14 en todos los PDV (pagas incluidas) con los pagos del 80.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const codPro = (request.nextUrl.searchParams.get("codPro") ?? "").trim();
  if (!codPro || codPro.length > 40) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const [facturas, prov] = await Promise.all([
      prisma.$queryRaw<FacturaCtaCteRow[]>(facturasCtaCteSql(codPro)),
      prisma.$queryRaw<ProveedorCtaCteRow[]>(proveedorCtaCteSql(codPro)),
    ]);
    const p = prov[0];
    const desde = impagasDesde(null, process.env.IMPAGAS_DESDE);
    return NextResponse.json({
      codPro,
      proveedor: p?.nombre?.trim() || `Proveedor ${codPro}`,
      razon: p?.razon ?? null,
      cuit: p?.cuit ?? null,
      pagoAutomatico: !!p?.pago_automatico,
      desdeCobertura: desde,
      facturas: facturas.map((f) => {
        const total = Number(f.total), pagado = Number(f.pagado);
        return {
          pdvId: Number(f.pdv_id),
          pdv: f.pdv,
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
