import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import { parsearImporte } from "@/lib/dashboard/importe-busqueda";

export const dynamic = "force-dynamic";

const qSchema = z.string().trim().max(40);
const idSchema = z.coerce.number().int().positive().optional();

// Un gasto cuyo importe coincide con lo tipeado. Trae proveedor/concepto con
// sus ids para que el palette pueda llevar al usuario a esa fila del panel
// (filtro por proveedor, o por concepto si no tiene proveedor) en su año.
export type ImporteResult = {
  id: string;
  fecha: string | null;
  importe: string;
  observac: string | null;
  conceptoCodigo: string | null;
  conceptoNombre: string | null;
  proveedorId: number | null;
  proveedorNombre: string | null;
};

type ImporteRow = {
  rowId: string;
  fecha: string | null;
  importe: Prisma.Decimal;
  observac: string | null;
  conceptoCodigo: string | null;
  conceptoNombre: string | null;
  proveedorId: number | null;
  proveedorNombre: string | null;
};

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const q = qSchema.safeParse(searchParams.get("q")).data ?? "";
  const buscado = parsearImporte(q);
  if (!buscado) return NextResponse.json([]);
  const localId = idSchema.safeParse(searchParams.get("localId") ?? undefined).data;
  const pdvId = idSchema.safeParse(searchParams.get("pdvId") ?? undefined).data;

  // Se busca sobre `compras` (no sobre la vista distribuida): lo que se rastrea
  // es el importe COMPLETO del gasto, que es el que aparece en el banco; la
  // vista reparte una compra aperturada entre destinos y nunca mostraría ese
  // total. local/PDV filtran por el origen del gasto. Mismas reglas de fecha e
  // importe efectivos que el pivot (query-builders.ts); sin año: el palette
  // navega al año del resultado elegido.
  const importeExpr = Prisma.sql`ABS(COALESCE(c."importeManual", c.importe))`;
  const valor = new Prisma.Decimal(buscado.valor);
  const importeCond = buscado.conCentavos
    ? Prisma.sql`${importeExpr} = ${valor}`
    : Prisma.sql`${importeExpr} >= ${valor} AND ${importeExpr} < ${valor.plus(1)}`;
  const where = Prisma.join(
    [...buildPivotConditions({ tableAlias: "c", localId, pdvId }), importeCond],
    " AND "
  );

  try {
    const rows = await prisma.$queryRaw<ImporteRow[]>(Prisma.sql`
      SELECT
        c."rowId"                                                      AS "rowId",
        TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD')      AS fecha,
        COALESCE(c."importeManual", c.importe)                         AS importe,
        COALESCE(c."observacManual", c.observac)                       AS observac,
        cc.codigo                                                      AS "conceptoCodigo",
        cc.nombre                                                      AS "conceptoNombre",
        p.id                                                           AS "proveedorId",
        COALESCE(p.nombre, p.razon)                                    AS "proveedorNombre"
      FROM compras c
      LEFT JOIN conceptos_caja cc ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
      LEFT JOIN proveedores p     ON c."proveedorId" = p.id
      WHERE ${where}
      ORDER BY COALESCE(c."fechaManual", c.fecha) DESC
      LIMIT 20
    `);

    const results: ImporteResult[] = rows.map((r) => ({
      id: `importe:${r.rowId}`,
      fecha: r.fecha,
      importe: r.importe.toString(),
      observac: r.observac,
      conceptoCodigo: r.conceptoCodigo,
      conceptoNombre: r.conceptoNombre,
      proveedorId: r.proveedorId,
      proveedorNombre: r.proveedorNombre,
    }));

    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
