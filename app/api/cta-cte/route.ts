import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { impagasDesde } from "@/lib/impagas/query";
import { estadoPago } from "@/lib/cta-cte/estado";
import {
  encabezadoMovsSql, facturasCtaCteSql, movimientosCtaCteSql, proveedorCtaCteSql,
  type EncabezadoMovsRow, type FacturaCtaCteRow, type MovimientoCtaCteRow, type ProveedorCtaCteRow,
} from "@/lib/cta-cte/query";

export const dynamic = "force-dynamic";

// GET ?codPro: cuenta corriente del proveedor (solo lectura). Todas sus
// facturas del 14 en todos los PDV (pagas incluidas) con los pagos del 80.
// GET ?codPro&pdvId&nombre: sin proveedor del maestro (empleado, gastos
// varios): sus movimientos del 14 en ese PDV (sueldos, adelantos, etc.).
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const codPro = (sp.get("codPro") ?? "").trim();
  if (!codPro || codPro.length > 40) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const nombre = (sp.get("nombre") ?? "").trim().slice(0, 120);
  const pdvId = Number(sp.get("pdvId"));
  if (nombre && Number.isInteger(pdvId) && pdvId > 0) {
    try {
      const [movs, enc] = await Promise.all([
        prisma.$queryRaw<MovimientoCtaCteRow[]>(movimientosCtaCteSql(pdvId, codPro, nombre)),
        prisma.$queryRaw<EncabezadoMovsRow[]>(encabezadoMovsSql(pdvId, codPro, nombre)),
      ]);
      const e = enc[0];
      return NextResponse.json({
        modo: "movimientos",
        codPro, pdvId, pdv: e?.pdv ?? "", nombre,
        proveedor: e?.empleado ?? nombre,
        esEmpleado: !!e?.empleado,
        movimientos: movs.map((m) => ({
          rowId: m.row_id, fecha: m.fecha ?? "", comprobante: m.comprobante, concepto: m.concepto?.trim() || "—",
          rubro: m.rubro, observac: m.observac?.trim() || "", importe: Number(m.importe),
        })),
      });
    } catch (err) {
      console.error("[GET /api/cta-cte] movimientos", err);
      return NextResponse.json({ error: "No se pudo leer la cuenta corriente." }, { status: 500 });
    }
  }
  try {
    const [facturas, prov] = await Promise.all([
      prisma.$queryRaw<FacturaCtaCteRow[]>(facturasCtaCteSql(codPro)),
      prisma.$queryRaw<ProveedorCtaCteRow[]>(proveedorCtaCteSql(codPro)),
    ]);
    const p = prov[0];
    const desde = impagasDesde(null, process.env.IMPAGAS_DESDE);
    return NextResponse.json({
      modo: "facturas",
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
