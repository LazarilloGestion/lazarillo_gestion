import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { leerCsvArca, type ComprobanteArca } from "@/lib/arca/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST (cuerpo = el CSV de "Mis Comprobantes" recibidos de ARCA, como texto). Guarda cada
// comprobante una sola vez: la clave es emisor + tipo + punto de venta + número, y si ya
// estaba se actualiza (nunca se duplica). Diego 28/10/2026.
const LOTE = 500;

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const texto = await request.text().catch(() => "");
  if (!texto.trim()) return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
  if (texto.length > 8_000_000) return NextResponse.json({ error: "El archivo es demasiado grande (partilo por año)." }, { status: 413 });

  const { comprobantes, errores } = leerCsvArca(texto);
  if (!comprobantes.length) return NextResponse.json({ error: errores[0] ?? "No se encontraron comprobantes.", errores }, { status: 400 });

  // Dentro del mismo archivo, la misma clave una sola vez (queda la última fila).
  const unicos = new Map<string, ComprobanteArca>();
  for (const c of comprobantes) unicos.set(`${c.cuitEmisor}|${c.tipo}|${c.puntoVenta}|${c.numero}`, c);
  const lista = [...unicos.values()];
  const por = user.email ?? user.id;

  try {
    let nuevos = 0, actualizados = 0;
    for (let i = 0; i < lista.length; i += LOTE) {
      const l = lista.slice(i, i + LOTE);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const filas = await prisma.$queryRaw<{ nuevo: boolean }[]>(Prisma.sql`
        INSERT INTO arca_comprobantes ("cuitReceptor","cuitEmisor",emisor,tipo,"puntoVenta",numero,fecha,cae,moneda,"tipoCambio",
                                       neto,"noGravado",exento,"otrosTributos",iva,total,"importadoPor")
        SELECT * FROM unnest(
          ${l.map((c) => c.cuitReceptor)}::text[], ${l.map((c) => c.cuitEmisor)}::text[], ${l.map((c) => c.emisor)}::text[],
          ${l.map((c) => c.tipo)}::int[], ${l.map((c) => c.puntoVenta)}::int[], ${l.map((c) => String(c.numero))}::bigint[],
          ${l.map((c) => c.fecha)}::date[], ${l.map((c) => c.cae)}::text[], ${l.map((c) => c.moneda)}::text[],
          ${l.map((c) => c.tipoCambio)}::numeric[], ${l.map((c) => r2(c.neto))}::numeric[], ${l.map((c) => r2(c.noGravado))}::numeric[],
          ${l.map((c) => r2(c.exento))}::numeric[], ${l.map((c) => r2(c.otrosTributos))}::numeric[], ${l.map((c) => r2(c.iva))}::numeric[],
          ${l.map((c) => r2(c.total))}::numeric[], ${l.map(() => por)}::text[])
        ON CONFLICT ("cuitEmisor", tipo, "puntoVenta", numero) DO UPDATE SET
          "cuitReceptor" = EXCLUDED."cuitReceptor", emisor = EXCLUDED.emisor, fecha = EXCLUDED.fecha, cae = EXCLUDED.cae,
          moneda = EXCLUDED.moneda, "tipoCambio" = EXCLUDED."tipoCambio", neto = EXCLUDED.neto, "noGravado" = EXCLUDED."noGravado",
          exento = EXCLUDED.exento, "otrosTributos" = EXCLUDED."otrosTributos", iva = EXCLUDED.iva, total = EXCLUDED.total,
          "importadoEn" = now(), "importadoPor" = EXCLUDED."importadoPor"
        RETURNING (xmax = 0) AS nuevo`);
      for (const f of filas) { if (f.nuevo) nuevos++; else actualizados++; }
    }
    const fechas = lista.map((c) => c.fecha).sort();
    return NextResponse.json({ ok: true, nuevos, actualizados, errores, desde: fechas[0], hasta: fechas[fechas.length - 1] });
  } catch (err) {
    console.error("[POST /api/arca/importar]", err);
    return NextResponse.json({ error: "No se pudo guardar el archivo de ARCA." }, { status: 500 });
  }
}
