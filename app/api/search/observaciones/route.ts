import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

export type ObservacionResult = {
  id: string;
  rowId: string;
  label: string;
  fecha: string | null;
  conceptoNombre: string | null;
  conceptoCodigo: string | null;
  rubroCodigo: string | null;
  proveedorNombre: string | null;
};

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json([]);

  try {
    const rows = await prisma.compra.findMany({
      where: {
        OR: [
          { observac: { contains: q, mode: "insensitive" } },
          { observacManual: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        rowId: true,
        fecha: true,
        observac: true,
        observacManual: true,
        proveedorRef: { select: { nombre: true, razon: true } },
        conceptoCodigoManual: true,
        conceptoCodigo: true,
        conceptoCajaManual: { select: { nombre: true, codRga: true, rubro: { select: { codigo: true } } } },
        conceptoCaja:       { select: { nombre: true, codRga: true, rubro: { select: { codigo: true } } } },
      },
      orderBy: { fecha: "desc" },
      take: 12,
    });

    const results: ObservacionResult[] = rows.map((r) => {
      const concepto = r.conceptoCajaManual ?? r.conceptoCaja;
      return {
        id: `observacion:${r.rowId}`,
        rowId: r.rowId,
        label: r.observacManual ?? r.observac ?? "",
        fecha: r.fecha ? r.fecha.toISOString().slice(0, 10) : null,
        conceptoNombre: concepto?.nombre ?? null,
        conceptoCodigo: r.conceptoCodigoManual ?? r.conceptoCodigo ?? null,
        rubroCodigo: concepto?.rubro?.codigo ?? null,
        proveedorNombre: r.proveedorRef?.nombre ?? r.proveedorRef?.razon ?? null,
      };
    });

    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
