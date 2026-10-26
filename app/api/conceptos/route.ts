import { NextRequest, NextResponse } from "next/server";
import { conceptoPropioSchema, proximoCodigoLazarillo, CODIGO_MIN_LAZARILLO, esPropio } from "@/lib/conceptos/abm";
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

// Conceptos propios de Lazarillo (código >= 1000): viven solo en el Panel.
async function conceptosPropios(): Promise<ConceptoMaestro[]> {
  const filas = await prisma.conceptoCaja.findMany({
    where: { codigo: { gte: String(CODIGO_MIN_LAZARILLO) } },
    select: { codigo: true, nombre: true, tipo: true, codRga: true, codImp: true, rubro: { select: { nombre: true } } },
  });
  // codigo es texto: el gte de arriba es lexicográfico, se filtra de nuevo como número.
  return filas
    .filter((c) => esPropio(c.codigo))
    .map((c) => ({ codigo: Number(c.codigo), nombre: c.nombre, tipo: c.tipo, codRubro: c.codRga != null ? Number(c.codRga) : null, rubro: c.rubro?.nombre ?? null, imputacion: c.codImp }));
}

async function rubrosPanel() {
  const r = await prisma.rubroConceptoCaja.findMany({ select: { codigo: true, nombre: true } });
  return r.sort((a, b) => Number(a.codigo) - Number(b.codigo));
}

export async function GET() {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const conRegistros = await codigosConRegistros().catch(() => null);
  const [propios, rubros] = await Promise.all([conceptosPropios(), rubrosPanel()]);

  if (renderConfigurado()) {
    try {
      const origen = await prisma.renderOrigen.findFirst({ where: { activo: true }, select: { esquema: true } });
      if (origen) {
        const deMaxirest = (await leerConceptos(origen.esquema)).filter((c) => !esPropio(c.codigo));
        return NextResponse.json({ fuente: "render", conceptos: [...deMaxirest, ...propios], conRegistros, rubros });
      }
    } catch (err) {
      console.error("[GET /api/conceptos] Render", err);
    }
  }
  const filas = await prisma.conceptoCaja.findMany({
    select: { codigo: true, nombre: true, tipo: true, codRga: true, rubro: { select: { nombre: true } } },
  });
  const conceptos: ConceptoMaestro[] = filas
    .map((c) => ({ codigo: Number(c.codigo), nombre: c.nombre.trim(), tipo: c.tipo, codRubro: c.codRga != null ? Number(c.codRga) : null, rubro: c.rubro?.nombre ?? null }))
    .filter((c) => Number.isFinite(c.codigo) && !esPropio(c.codigo))
    .sort((a, b) => a.codigo - b.codigo);
  return NextResponse.json({ fuente: "panel", conceptos: [...conceptos, ...propios], conRegistros, rubros });
}

// POST — alta de un concepto propio de Lazarillo (código desde 1000).
export async function POST(req: NextRequest) {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const parsed = conceptoPropioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 422 });
  const d = parsed.data;
  const rubro = await prisma.rubroConceptoCaja.findUnique({ where: { codigo: d.codRubro }, select: { codigo: true } });
  if (!rubro) return NextResponse.json({ error: "El rubro no existe" }, { status: 422 });
  const existentes = await prisma.conceptoCaja.findMany({ select: { codigo: true } });
  const codigo = d.codigo ?? proximoCodigoLazarillo(existentes.map((c) => c.codigo));
  if (existentes.some((c) => Number(c.codigo) === codigo)) return NextResponse.json({ error: `El código ${codigo} ya existe` }, { status: 409 });
  const creado = await prisma.conceptoCaja.create({
    data: { codigo: String(codigo), nombre: d.nombre, tipo: d.tipo, codRga: d.codRubro, codImp: d.imputacion },
    select: { codigo: true },
  });
  return NextResponse.json({ codigo: Number(creado.codigo) }, { status: 201 });
}
