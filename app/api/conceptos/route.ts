import { NextRequest, NextResponse } from "next/server";
import { conceptoPropioSchema, proximoCodigoLazarillo, CODIGO_MIN_LAZARILLO, esPropio } from "@/lib/conceptos/abm";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/prisma";
import { reglasCopiadas } from "@/lib/conceptos/padrino";
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

// Conceptos de MaxiRest editados en Lazarillo (Diego 29/10/2026): se muestra lo de Lazarillo y,
// en gris, el original de MaxiRest.
type Original = { nombre: string; tipo: string | null; codRubro: number | null; rubro: string | null };
async function editados(): Promise<Map<number, { actual: Omit<ConceptoMaestro, "codigo">; original: Original }>> {
  const filas = await prisma.$queryRaw<{ codigo: string; nombre: string; tipo: string | null; codRga: string | null; rubro: string | null;
    nombreMx: string | null; tipoMx: string | null; codRgaMx: string | null; rubroMx: string | null }[]>`
    SELECT c.codigo, c.nombre, c.tipo, c."codRga", r.nombre AS rubro,
           c."nombreMaxirest" AS "nombreMx", c."tipoMaxirest" AS "tipoMx", c."codRgaMaxirest" AS "codRgaMx", rm.nombre AS "rubroMx"
    FROM conceptos_caja c
    LEFT JOIN rubros_concepto_caja r ON r.codigo = c."codRga"
    LEFT JOIN rubros_concepto_caja rm ON rm.codigo = c."codRgaMaxirest"
    WHERE c."editadoEnLazarillo"`;
  return new Map(filas.map((f) => [Number(f.codigo), {
    actual: { nombre: f.nombre.trim(), tipo: f.tipo, codRubro: f.codRga != null ? Number(f.codRga) : null, rubro: f.rubro?.trim() ?? null },
    original: { nombre: (f.nombreMx ?? f.nombre).trim(), tipo: f.tipoMx, codRubro: f.codRgaMx != null ? Number(f.codRgaMx) : null, rubro: f.rubroMx?.trim() ?? null },
  }]));
}
function conEdiciones(lista: ConceptoMaestro[], ed: Map<number, { actual: Omit<ConceptoMaestro, "codigo">; original: Original }>) {
  return lista.map((c) => {
    const e = ed.get(c.codigo);
    return e ? { ...c, ...e.actual, editado: true, original: e.original } : c;
  });
}

async function rubrosPanel() {
  const r = await prisma.rubroConceptoCaja.findMany({ select: { codigo: true, nombre: true } });
  return r.sort((a, b) => Number(a.codigo) - Number(b.codigo));
}

export async function GET() {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const conRegistros = await codigosConRegistros().catch(() => null);
  const [propios, rubros, ed] = await Promise.all([conceptosPropios(), rubrosPanel(), editados().catch(() => new Map())]);

  if (renderConfigurado()) {
    try {
      const origen = await prisma.renderOrigen.findFirst({ where: { activo: true }, select: { esquema: true } });
      if (origen) {
        const deMaxirest = (await leerConceptos(origen.esquema)).filter((c) => !esPropio(c.codigo));
        return NextResponse.json({ fuente: "render", conceptos: [...conEdiciones(deMaxirest, ed), ...propios], conRegistros, rubros });
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
  return NextResponse.json({ fuente: "panel", conceptos: [...conEdiciones(conceptos, ed), ...propios], conRegistros, rubros });
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
  // Padrino: concepto existente (de MaxiRest o de Lazarillo) del que se copian
  // las reglas de apertura activas. Tipo y rubro ya vienen copiados desde la pantalla.
  const padrino = d.padrino ? String(Number(d.padrino)) : null;
  const reglasPadrino = padrino
    ? await prisma.reglaApertura.findMany({ where: { nivel: "concepto", entidadId: padrino, estado: "activa" }, include: { destinos: true } })
    : [];
  const creadoPor = auth.user.email ?? auth.user.id;
  const creado = await prisma.$transaction(async (tx) => {
    const c = await tx.conceptoCaja.create({
      data: { codigo: String(codigo), nombre: d.nombre, tipo: d.tipo, codRga: d.codRubro, codImp: d.imputacion || null },
      select: { codigo: true },
    });
    for (const data of reglasCopiadas(reglasPadrino, c.codigo, creadoPor)) await tx.reglaApertura.create({ data });
    return c;
  });
  return NextResponse.json({ codigo: Number(creado.codigo), reglasCopiadas: reglasPadrino.length }, { status: 201 });
}
