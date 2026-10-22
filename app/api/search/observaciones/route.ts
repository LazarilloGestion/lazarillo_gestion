import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";

export const dynamic = "force-dynamic";

const qSchema = z.string().trim().max(200);
const idSchema = z.coerce.number().int().positive().optional();

export type ObservacionResult = {
  id: string;
  label: string;
  fecha: string | null;
  importe: string | null;
  conceptoNombre: string | null;
  proveedorNombre: string | null;
  // Dónde vive el gasto (origen, no destino de apertura): la búsqueda recorre todos los PDV
  // y el palette etiqueta/navega a los de otro PDV (Diego, 22/10/2026).
  localId: number | null;
  localNombre: string | null;
  puntoDeVentaId: number | null;
  puntoDeVentaNombre: string | null;
};

type ObservacionRow = {
  rowId: string;
  observac: string | null;
  fecha: string | null;
  importe: Prisma.Decimal | null;
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
  if (q.length < 2) return NextResponse.json([]);
  const localId = idSchema.safeParse(searchParams.get("localId") ?? undefined).data;
  const pdvId = idSchema.safeParse(searchParams.get("pdvId") ?? undefined).data;
  // Mismas reglas que el pivot (query-builders.ts): vista distribuida con local/PDV destino,
  // observación/fecha/importe efectivos. Sin año: el palette navega al año del resultado elegido.
  const where = Prisma.join(
    buildPivotConditions({ tableAlias: "c", localId, pdvId, observacionQuery: q }),
    " AND "
  );

  try {
    // La vista repite una compra aperturada por cada destino (mismo rowId); sin filtro de PDV
    // hay que quedarse con una sola fila por compra o el resultado aparece duplicado.
    const rows = await prisma.$queryRaw<ObservacionRow[]>(Prisma.sql`
      SELECT * FROM (
        SELECT DISTINCT ON (c."rowId")
          c."rowId"                                                      AS "rowId",
          COALESCE(c."observacManual", c.observac)                       AS observac,
          TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')      AS fecha,
          COALESCE(c."importeManual", c.importe)                         AS importe,
          cc.nombre                                                      AS "conceptoNombre",
          COALESCE(p.nombre, p.razon)                                    AS "proveedorNombre",
          c."localIdOrigen"                                              AS "localId",
          l.nombre                                                       AS "localNombre",
          c."puntoDeVentaIdOrigen"                                       AS "puntoDeVentaId",
          pv.nombre                                                      AS "puntoDeVentaNombre"
        FROM v_compras_distribuidas c
        LEFT JOIN conceptos_caja cc  ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
        LEFT JOIN proveedores p      ON c."proveedorId" = p.id
        LEFT JOIN locales l          ON c."localIdOrigen" = l.id
        LEFT JOIN puntos_de_venta pv ON c."puntoDeVentaIdOrigen" = pv.id
        WHERE ${where}
        ORDER BY c."rowId"
      ) t
      ORDER BY fecha DESC
      LIMIT 12
    `);

    const results: ObservacionResult[] = rows.map((r) => ({
      id: `observacion:${r.rowId}`,
      label: r.observac ?? "",
      fecha: r.fecha,
      importe: r.importe != null ? r.importe.toString() : null,
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
