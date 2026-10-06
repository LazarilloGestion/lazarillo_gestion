import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";

export const dynamic = "force-dynamic";

const qSchema = z.string().trim().max(200);
const idSchema = z.coerce.number().int().positive().optional();

type OrigenRow = {
  conceptoCodigo: string | null;
  rubroCodigo: string | null;
  proveedorId: number | null;
};

// Rubros, conceptos y proveedores con al menos una compra en el local/PDV dado, de cualquier año.
// Mismas reglas que el pivot (fecha/importe efectivos, local/PDV destino de la vista distribuida),
// así toda sugerencia corresponde a algo que la tabla puede mostrar en ese origen.
async function origenesConCompras(localId: number | undefined, pdvId: number | undefined) {
  const where = Prisma.join(buildPivotConditions({ tableAlias: "c", localId, pdvId }), " AND ");
  const rows = await prisma.$queryRaw<OrigenRow[]>(Prisma.sql`
    SELECT DISTINCT
      COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") AS "conceptoCodigo",
      cc."codRga"                                            AS "rubroCodigo",
      c."proveedorId"                                        AS "proveedorId"
    FROM v_compras_distribuidas c
    LEFT JOIN conceptos_caja cc ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    WHERE ${where}
  `);
  const sinNulos = <T,>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);
  return {
    rubros: sinNulos(rows.map((r) => r.rubroCodigo)),
    conceptos: sinNulos(rows.map((r) => r.conceptoCodigo)),
    proveedores: sinNulos(rows.map((r) => r.proveedorId)),
  };
}

export type Suggestion = {
  id: string;
  label: string;
  type: "rubro" | "concepto" | "proveedor";
  // payload que se mapea a URL param
  param: "rubroCodigo" | "conceptoCodigo" | "proveedorId";
  value: string;
  rubroNombre?: string; // solo para type === "concepto"
  rubroCodigo?: string; // solo para type === "concepto"
};

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  // Sin query: preview alfabético acotado (pantalla "Buscar en" antes de tipear).
  // Con query: búsqueda real sobre toda la tabla vía ILIKE, no limitada por el preview.
  const { searchParams } = new URL(request.url);
  const q = qSchema.safeParse(searchParams.get("q")).data ?? "";
  const localId = idSchema.safeParse(searchParams.get("localId") ?? undefined).data;
  const pdvId = idSchema.safeParse(searchParams.get("pdvId") ?? undefined).data;
  const sanitizedQ = q.replace(/[%_\\]/g, "\\$&"); // escapa wildcards de ILIKE
  const textFilter = q.length > 0 ? { contains: sanitizedQ, mode: "insensitive" as const } : undefined;

  try {
    // Sin local ni PDV activo no se acota nada (comportamiento previo).
    const origen = localId !== undefined || pdvId !== undefined ? await origenesConCompras(localId, pdvId) : null;

    const [rubros, conceptos, proveedores] = await Promise.all([
      prisma.rubroConceptoCaja.findMany({
        select: { codigo: true, nombre: true },
        where: {
          ...(textFilter ? { nombre: textFilter } : {}),
          ...(origen ? { codigo: { in: origen.rubros } } : {}),
        },
        orderBy: { nombre: "asc" },
        take: textFilter ? 50 : 500,
      }),
      prisma.conceptoCaja.findMany({
        select: { codigo: true, nombre: true, rubro: { select: { codigo: true, nombre: true } } },
        where: {
          ...(textFilter ? { nombre: textFilter } : {}),
          ...(origen ? { codigo: { in: origen.conceptos } } : {}),
        },
        orderBy: { nombre: "asc" },
        take: textFilter ? 50 : 500,
      }),
      prisma.proveedor.findMany({
        select: { id: true, nombre: true, razon: true },
        where: {
          ...(textFilter ? { OR: [{ nombre: textFilter }, { razon: textFilter }] } : {}),
          ...(origen ? { id: { in: origen.proveedores } } : {}),
        },
        orderBy: [{ nombre: "asc" }],
        take: textFilter ? 50 : 200,
      }),
    ]);

    const suggestions: Suggestion[] = [
      ...rubros.map((r) => ({
        id: `rubro:${r.codigo}`,
        label: r.nombre ?? r.codigo,
        type: "rubro" as const,
        param: "rubroCodigo" as const,
        value: r.codigo,
      })),
      ...conceptos.map((c) => ({
        id: `concepto:${c.codigo}`,
        label: c.nombre ?? c.codigo,
        type: "concepto" as const,
        param: "conceptoCodigo" as const,
        value: c.codigo,
        rubroNombre: c.rubro?.nombre ?? undefined,
        rubroCodigo: c.rubro?.codigo ?? undefined,
      })),
      ...proveedores.map((p) => ({
        id: `proveedor:${p.id}`,
        label: p.nombre ?? p.razon ?? `Proveedor ${p.id}`,
        type: "proveedor" as const,
        param: "proveedorId" as const,
        value: String(p.id),
      })),
    ];

    return NextResponse.json(suggestions);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
