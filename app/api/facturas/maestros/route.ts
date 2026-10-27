import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { renderConfigurado, leerInsumos, type InsumoMaestro } from "@/lib/render/db";
import { unirInsumos } from "@/lib/facturas/insumos";

export const dynamic = "force-dynamic";

// Maestros del modal de carga de facturas (Etapa 4): proveedores y conceptos de
// caja del Panel, e insumos: el maestro de MaxiRest (m0, en Render) con el
// concepto de caja de su RUBRO (Diego, 27/10/2026), más los que solo aparecen en
// el informe 25; el último precio y alícuota salen de la última compra.
// El maestro de Render (Oregon) cambia una vez por día: se guarda 10 minutos en la
// instancia para no volver a cruzar al norte en cada apertura del modal.
let cacheInsumos: { hasta: number; datos: InsumoMaestro[] } | null = null;
async function insumosMaxirest(): Promise<InsumoMaestro[]> {
  if (!renderConfigurado()) return [];
  if (cacheInsumos && cacheInsumos.hasta > Date.now()) return cacheInsumos.datos;
  try {
    const origen = await prisma.renderOrigen.findFirst({ where: { activo: true }, select: { esquema: true } });
    const datos = origen ? await leerInsumos(origen.esquema) : [];
    cacheInsumos = { hasta: Date.now() + 10 * 60_000, datos };
    return datos;
  } catch (err) {
    console.error("[facturas/maestros] Render", err);
    return [];
  }
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const [proveedores, conceptos, comprados, deMaxirest] = await Promise.all([
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
      insumosMaxirest(),
    ]);
    return NextResponse.json({
      proveedores,
      conceptos: conceptos.map((c) => ({ codigo: c.codigo.trim(), nombre: c.nombre.trim(), rubro: c.rubro?.nombre?.trim() ?? "Sin Rubro" })),
      insumos: unirInsumos(deMaxirest, comprados),
    });
  } catch (err) {
    console.error("[facturas/maestros]", err);
    return NextResponse.json({ error: "No se pudieron leer los maestros" }, { status: 500 });
  }
}
