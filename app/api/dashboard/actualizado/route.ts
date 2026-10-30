import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

// "Actualizado al …" del encabezado del panel (Diego, 24/10/2026): último día
// con ventas y con compras del local/PDV elegido, y cuándo fue la última
// importación que salió bien.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const sp = new URL(request.url).searchParams;
  const localId = Number(sp.get("localId")) || null;
  const pdvId = Number(sp.get("pdvId")) || null;
  const filtro = (alias: string) => {
    const c: Prisma.Sql[] = [Prisma.sql`${Prisma.raw(alias)}.fecha <= now() + interval '1 day'`];
    if (localId) c.push(Prisma.sql`${Prisma.raw(alias)}."localId" = ${localId}`);
    if (pdvId) c.push(Prisma.sql`${Prisma.raw(alias)}."puntoDeVentaId" = ${pdvId}`);
    return Prisma.join(c, " AND ");
  };

  try {
    const [r] = await prisma.$queryRaw<{ ventas: string | null; compras: string | null; importado: Date | null }[]>(Prisma.sql`
      SELECT
        -- MAX(fecha)::date y no MAX(fecha::date): así sale del índice al toque (6 s → 10 ms, 29/10/2026).
        (SELECT to_char(MAX(v.fecha)::date, 'YYYY-MM-DD') FROM ventas v WHERE ${filtro("v")}) AS ventas,
        (SELECT to_char(MAX(c.fecha)::date, 'YYYY-MM-DD') FROM compras c WHERE ${filtro("c")}) AS compras,
        (SELECT MAX("creadoEn") FROM import_logs WHERE estado = 'ok') AS importado
    `);
    return NextResponse.json({
      ventas: r?.ventas ?? null,
      compras: r?.compras ?? null,
      importado: r?.importado ? new Date(r.importado).toISOString() : null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
