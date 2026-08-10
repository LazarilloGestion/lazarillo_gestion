import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

const qSchema = z.string().trim().max(200);

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
  const q = qSchema.safeParse(new URL(request.url).searchParams.get("q")).data ?? "";
  const sanitizedQ = q.replace(/[%_\\]/g, "\\$&"); // escapa wildcards de ILIKE
  const textFilter = q.length > 0 ? { contains: sanitizedQ, mode: "insensitive" as const } : undefined;

  try {
    const [rubros, conceptos, proveedores] = await Promise.all([
      prisma.rubroConceptoCaja.findMany({
        select: { codigo: true, nombre: true },
        where: textFilter ? { nombre: textFilter } : undefined,
        orderBy: { nombre: "asc" },
        take: textFilter ? 50 : 500,
      }),
      prisma.conceptoCaja.findMany({
        select: { codigo: true, nombre: true, rubro: { select: { codigo: true, nombre: true } } },
        where: textFilter ? { nombre: textFilter } : undefined,
        orderBy: { nombre: "asc" },
        take: textFilter ? 50 : 500,
      }),
      prisma.proveedor.findMany({
        select: { id: true, nombre: true, razon: true },
        where: textFilter ? { OR: [{ nombre: textFilter }, { razon: textFilter }] } : undefined,
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
