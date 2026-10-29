import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { altaSchema, claveIngreso, COD_COBRO_MANUAL, PREFIJO_MANUAL } from "@/lib/ventas-manuales/carga";

export const dynamic = "force-dynamic";

// Ingresos cargados a mano en Ventas (Diego 29/10/2026). Ver lib/ventas-manuales/carga.ts.
const pdvDe = (sp: URLSearchParams) => { const n = Number(sp.get("pdvId")); return Number.isInteger(n) && n > 0 ? n : null; };
const MAN = `${PREFIJO_MANUAL}%`;

// GET ?pdvId — lo cargado a mano (últimos 400), los días donde ya hay ventas reales de MaxiRest
// además de la carga manual (para no contar dos veces) y los tipos / formas de cobro del PDV.
export async function GET(request: NextRequest) {
  const { response } = await requireAuthUser();
  if (response) return response;
  const pdvId = pdvDe(request.nextUrl.searchParams);
  if (!pdvId) return NextResponse.json({ error: "Falta el PDV" }, { status: 400 });
  try {
    const [items, solapadas, tipos, cobros] = await Promise.all([
      prisma.$queryRaw<{ rowId: string; fecha: string; tipo: string | null; cobro: string | null; importe: number; detalle: string | null; cliente: string | null }[]>`
        SELECT "rowId", TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, tipo, cobro, importe::float8 AS importe,
               comprobant AS detalle, "cliRazon" AS cliente
        FROM ventas WHERE "puntoDeVentaId" = ${pdvId} AND "rowId" LIKE ${MAN}
        ORDER BY fecha DESC, tipo NULLS LAST LIMIT 400`,
      prisma.$queryRaw<{ fecha: string; manual: number; real: number }[]>`
        SELECT TO_CHAR(m.dia, 'YYYY-MM-DD') AS fecha, m.total::float8 AS manual, r.total::float8 AS real
        FROM (SELECT fecha::date AS dia, SUM(importe) AS total FROM ventas
              WHERE "puntoDeVentaId" = ${pdvId} AND "rowId" LIKE ${MAN} GROUP BY 1) m
        JOIN (SELECT fecha::date AS dia, SUM(importe) AS total FROM ventas
              WHERE "puntoDeVentaId" = ${pdvId} AND "rowId" NOT LIKE ${MAN}
                AND fecha >= (SELECT MIN(fecha) FROM ventas WHERE "puntoDeVentaId" = ${pdvId} AND "rowId" LIKE ${MAN})
              GROUP BY 1) r ON r.dia = m.dia
        ORDER BY 1`,
      prisma.$queryRaw<{ v: string }[]>`
        SELECT DISTINCT TRIM(tipo) AS v FROM ventas WHERE "puntoDeVentaId" = ${pdvId} AND fecha >= NOW() - INTERVAL '400 days'
          AND tipo IS NOT NULL AND TRIM(tipo) <> '' ORDER BY 1 LIMIT 20`,
      prisma.$queryRaw<{ v: string }[]>`
        SELECT DISTINCT TRIM(cobro) AS v FROM ventas WHERE "puntoDeVentaId" = ${pdvId} AND fecha >= NOW() - INTERVAL '400 days'
          AND cobro IS NOT NULL AND TRIM(cobro) <> '' AND "codCobro" <> ${COD_COBRO_MANUAL}
          AND cobro !~ '^(FC|NC|ND)[ABC] ' ORDER BY 1 LIMIT 30`,
    ]);
    return NextResponse.json({ items, solapadas, tipos: tipos.map((t) => t.v), cobros: cobros.map((c) => c.v) });
  } catch (err) {
    console.error("[GET /api/ventas-manuales]", err);
    return NextResponse.json({ error: "No se pudo leer." }, { status: 500 });
  }
}

// POST { pdvId, items[], forzar? } — nunca duplica: si un ingreso igual (día, tipo, forma de
// cobro e importe) ya está cargado a mano, avisa y no guarda nada salvo forzar.
export async function POST(request: NextRequest) {
  const { response } = await requireAuthUser();
  if (response) return response;
  const parsed = altaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", detalle: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const { pdvId, items, forzar } = parsed.data;
  const pdv = await prisma.puntoDeVenta.findUnique({ where: { id: pdvId }, select: { id: true, localId: true } });
  if (!pdv) return NextResponse.json({ error: "PDV inexistente" }, { status: 400 });

  // Repetidos dentro de lo que se manda.
  const vistos = new Set<string>();
  for (const it of items) {
    const k = claveIngreso(it);
    if (vistos.has(k)) return NextResponse.json({ error: `El ingreso del ${it.fecha} por ${it.importe} está dos veces.` }, { status: 400 });
    vistos.add(k);
  }
  if (!forzar) {
    const fechas = items.map((i) => i.fecha).sort();
    const ya = await prisma.$queryRaw<{ fecha: string; tipo: string | null; cobro: string | null; importe: number }[]>`
      SELECT TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, tipo, cobro, importe::float8 AS importe FROM ventas
      WHERE "puntoDeVentaId" = ${pdvId} AND "rowId" LIKE ${MAN}
        AND fecha >= ${fechas[0]}::date AND fecha < ${fechas[fechas.length - 1]}::date + 1`;
    const existentes = new Set(ya.map(claveIngreso));
    const repetidos = items.filter((i) => existentes.has(claveIngreso(i)));
    if (repetidos.length) return NextResponse.json({ error: "Ya cargados", repetidos }, { status: 409 });
  }

  const filas = items.map((it) => Prisma.sql`(
    ${PREFIJO_MANUAL + randomUUID().replace(/-/g, "").slice(0, 20)}, ${it.detalle}, ${it.tipo}, ${it.cobro}, ${COD_COBRO_MANUAL},
    ${it.importe}::numeric, ${it.importe}::numeric, ${it.importe}::numeric, 0, ${it.cliente},
    ${it.fecha}::timestamp, ${pdv.localId}::integer, ${pdvId}::integer)`);
  try {
    await prisma.$executeRaw`
      INSERT INTO ventas ("rowId", comprobant, tipo, cobro, "codCobro", importe, "importeTrabajado", total, descuento, "cliRazon", fecha, "localId", "puntoDeVentaId")
      VALUES ${Prisma.join(filas)}`;
  } catch (err) {
    console.error("[POST /api/ventas-manuales]", err);
    return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, cargados: items.length, total: items.reduce((s, i) => s + i.importe, 0) });
}

// DELETE ?pdvId&ids=man-a,man-b — solo borra cargas manuales.
export async function DELETE(request: NextRequest) {
  const { response } = await requireAuthUser();
  if (response) return response;
  const sp = request.nextUrl.searchParams;
  const pdvId = pdvDe(sp);
  const ids = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => s.startsWith(PREFIJO_MANUAL));
  if (!pdvId || !ids.length) return NextResponse.json({ error: "Nada para borrar" }, { status: 400 });
  const n = await prisma.$executeRaw`DELETE FROM ventas WHERE "puntoDeVentaId" = ${pdvId} AND "rowId" IN (${Prisma.join(ids)}) AND "rowId" LIKE ${MAN}`;
  return NextResponse.json({ ok: true, borrados: n });
}
