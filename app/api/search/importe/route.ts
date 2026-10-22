import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions, importeCondition } from "@/lib/dashboard/query-builders";

export const dynamic = "force-dynamic";

const qSchema = z.string().trim().max(40);

// Un gasto cuyo importe coincide con lo tipeado. Trae el local/PDV donde vive el
// gasto: la búsqueda recorre TODOS los PDV (un movimiento del banco puede ser
// de cualquiera) y el palette etiqueta los de otro PDV y navega hasta ahí.
export type ImporteResult = {
  id: string;
  fecha: string | null;
  importe: string;
  observac: string | null;
  conceptoNombre: string | null;
  proveedorNombre: string | null;
  localId: number | null;
  localNombre: string | null;
  puntoDeVentaId: number | null;
  puntoDeVentaNombre: string | null;
};

type ImporteRow = {
  rowId: string;
  fecha: string | null;
  importe: Prisma.Decimal;
  observac: string | null;
  conceptoNombre: string | null;
  proveedorNombre: string | null;
  localId: number | null;
  localNombre: string | null;
  puntoDeVentaId: number | null;
  puntoDeVentaNombre: string | null;
};

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const q = qSchema.safeParse(searchParams.get("q")).data ?? "";
  const cond = importeCondition("c", q);
  if (!cond) return NextResponse.json([]);

  // Sobre `compras` (no la vista distribuida): se busca el importe COMPLETO del
  // gasto. Sin local/PDV ni año: el palette navega al PDV y al año del elegido.
  // Mismas reglas de fecha/importe efectivos que el pivot.
  const where = Prisma.join([...buildPivotConditions({ tableAlias: "c" }), cond], " AND ");

  try {
    const rows = await prisma.$queryRaw<ImporteRow[]>(Prisma.sql`
      SELECT
        c."rowId"                                                      AS "rowId",
        TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')      AS fecha,
        COALESCE(c."importeManual", c.importe)                         AS importe,
        COALESCE(c."observacManual", c.observac)                       AS observac,
        cc.nombre                                                      AS "conceptoNombre",
        COALESCE(p.nombre, p.razon)                                    AS "proveedorNombre",
        c."localId"                                                    AS "localId",
        l.nombre                                                       AS "localNombre",
        c."puntoDeVentaId"                                             AS "puntoDeVentaId",
        pv.nombre                                                      AS "puntoDeVentaNombre"
      FROM compras c
      LEFT JOIN conceptos_caja cc    ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN proveedores p        ON c."proveedorId" = p.id
      LEFT JOIN locales l            ON c."localId" = l.id
      LEFT JOIN puntos_de_venta pv   ON c."puntoDeVentaId" = pv.id
      WHERE ${where}
      ORDER BY COALESCE(c."fechaManual", c.fecha) DESC
      LIMIT 20
    `);

    const results: ImporteResult[] = rows.map((r) => ({
      id: `importe:${r.rowId}`,
      fecha: r.fecha,
      importe: r.importe.toString(),
      observac: r.observac,
      conceptoNombre: r.conceptoNombre,
      proveedorNombre: r.proveedorNombre,
      localId: r.localId,
      localNombre: r.localNombre,
      puntoDeVentaId: r.puntoDeVentaId,
      puntoDeVentaNombre: r.puntoDeVentaNombre,
    }));

    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
