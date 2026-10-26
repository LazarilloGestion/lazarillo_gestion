import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/prisma";
import { renderConfigurado, leerConceptos, type ConceptoMaestro } from "@/lib/render/db";

export const runtime = "nodejs";

// GET — conceptos de caja de la organización (para la lista de códigos libres).
// Fuente: el maestro 17 que el kit sube a Render cada día (lo más fresco de
// MaxiRest); si Render no está configurado, el maestro importado al Panel.
// Códigos de concepto con al menos un registro en el Panel (concepto del ERP o
// el corregido a mano): los demás se marcan "sin uso" en la pantalla.
async function codigosConRegistros(): Promise<string[]> {
  const filas = await prisma.$queryRaw<{ c: string }[]>`
    SELECT DISTINCT "codCga" AS c FROM compras WHERE "codCga" IS NOT NULL
    UNION
    SELECT DISTINCT "conceptoCodigoManual" FROM compras WHERE "conceptoCodigoManual" IS NOT NULL`;
  return filas.map((f) => String(f.c).trim());
}

export async function GET() {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const conRegistros = await codigosConRegistros().catch(() => null);

  if (renderConfigurado()) {
    try {
      const origen = await prisma.renderOrigen.findFirst({ where: { activo: true }, select: { esquema: true } });
      if (origen) return NextResponse.json({ fuente: "render", conceptos: await leerConceptos(origen.esquema), conRegistros });
    } catch (err) {
      console.error("[GET /api/conceptos] Render", err);
    }
  }
  const filas = await prisma.conceptoCaja.findMany({
    select: { codigo: true, nombre: true, tipo: true, codRga: true, rubro: { select: { nombre: true } } },
  });
  const conceptos: ConceptoMaestro[] = filas
    .map((c) => ({ codigo: Number(c.codigo), nombre: c.nombre.trim(), tipo: c.tipo, codRubro: c.codRga != null ? Number(c.codRga) : null, rubro: c.rubro?.nombre ?? null }))
    .filter((c) => Number.isFinite(c.codigo))
    .sort((a, b) => a.codigo - b.codigo);
  return NextResponse.json({ fuente: "panel", conceptos, conRegistros });
}
