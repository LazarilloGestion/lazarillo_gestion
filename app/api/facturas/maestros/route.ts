import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

// Maestros del modal de carga de facturas (Etapa 4): proveedores y conceptos de
// caja del Panel, e insumos tal como vienen en el informe 25 (su medida, el
// concepto de caja de su última compra y, como sugerencia, el último precio).
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const [proveedores, conceptos, insumos] = await Promise.all([
      prisma.proveedor.findMany({
        select: { id: true, codigo: true, nombre: true, razon: true, cuit: true },
        orderBy: { nombre: "asc" },
      }),
      prisma.conceptoCaja.findMany({
        select: { codigo: true, nombre: true, rubro: { select: { codigo: true, nombre: true } } },
        orderBy: { nombre: "asc" },
      }),
      prisma.$queryRaw<{ codigo: string; nombre: string; medida: string; codCga: string | null; unit: number | null; alic: number | null }[]>(Prisma.sql`
        SELECT DISTINCT ON (codigo)
          codigo, TRIM(nombre) AS nombre, TRIM(medida) AS medida, "codCga",
          neto::float8 AS unit, tasa::float8 AS alic
        FROM detalle_compras
        WHERE NULLIF(TRIM(medida), '') IS NOT NULL AND codigo IS NOT NULL AND nombre IS NOT NULL
        ORDER BY codigo, fecha DESC NULLS LAST
      `),
    ]);
    return NextResponse.json({
      proveedores,
      conceptos: conceptos.map((c) => ({ codigo: c.codigo, nombre: c.nombre, rubro: c.rubro?.nombre ?? "Sin Rubro" })),
      insumos,
    });
  } catch (err) {
    console.error("[facturas/maestros]", err);
    return NextResponse.json({ error: "No se pudieron leer los maestros" }, { status: 500 });
  }
}
