import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";
import { aggregateFlujoCajaPorMes } from "@/lib/dashboard/flujo-caja-agg";
import { toNumber } from "@/lib/dashboard/pivot-utils";
import { MONTH_IDXS, type VisibilidadField } from "@/lib/dashboard/constants";
import { findPrimerArqueo } from "@/lib/dashboard/primer-arqueo";
import { buildDiferenciaCajaSerie, type TotalesAnio, type DiferenciaCajaMes } from "@/lib/dashboard/diferencia-caja-serie";

export const dynamic = "force-dynamic";

// Sin .min/.max en year: un año fuera de rango responde 200 con los 12 meses en null
// (mismo criterio que GET /api/dashboard/flujo-caja), no 400.
const getQuerySchema = z.object({
  year: z.coerce.number().int(),
  localId: z.coerce.number().int().optional(),
  puntoDeVentaId: z.coerce.number().int().optional(),
});

// Respuesta "sin datos": los 12 meses vacíos. Se usa tanto para el año fuera de rango
// como para el caso sin ningún arqueo.
function diferenciaVacia(): Record<number, DiferenciaCajaMes> {
  const vacio: Record<number, DiferenciaCajaMes> = {};
  for (const mes of MONTH_IDXS) vacio[mes] = { valor: null, acumulado: null };
  return vacio;
}

interface MesSumRow {
  mes: number;
  total: Prisma.Decimal | string | number | null;
}

// Suma mensual de compras (v_compras_distribuidas) para una vista de visibilidad. Reproduce el
// columnTotals que hoy calcula el endpoint de pivot, pero con GROUP BY en la DB en vez de volcar
// fila por fila. Mismos LEFT JOIN (cc, rc) que el pivot necesita para el predicado de visibilidad.
async function sumComprasPorMes(
  anio: number,
  localId: number | undefined,
  pdvId: number | undefined,
  visibilidadCol: VisibilidadField,
): Promise<Record<number, number>> {
  const conditions = buildPivotConditions({
    year: anio,
    tableAlias: "c",
    localId,
    pdvId,
    filterRubrosOcultos: true,
    visibilidadCol,
  });
  const where = Prisma.join(conditions, " AND ");
  const rows = await prisma.$queryRaw<MesSumRow[]>(Prisma.sql`
    SELECT
      EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int AS mes,
      SUM(COALESCE(c."importeManual", c.importe))                 AS total
    FROM v_compras_distribuidas c
    LEFT JOIN conceptos_caja cc       ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN rubros_concepto_caja rc ON cc."codRga" = rc.codigo
    WHERE ${where}
    GROUP BY 1
  `);
  const out: Record<number, number> = {};
  for (const r of rows) out[r.mes] = toNumber(r.total ?? 0);
  return out;
}

// Suma mensual de ventas. Mismo WHERE base que el endpoint de pivot-ventas (hasFechaManual: false,
// sin filtro de visibilidad).
async function sumVentasPorMes(
  anio: number,
  localId: number | undefined,
  pdvId: number | undefined,
): Promise<Record<number, number>> {
  const conditions = buildPivotConditions({
    year: anio,
    tableAlias: "v",
    hasFechaManual: false,
    localId,
    pdvId,
  });
  const where = Prisma.join(conditions, " AND ");
  const rows = await prisma.$queryRaw<MesSumRow[]>(Prisma.sql`
    SELECT
      EXTRACT(MONTH FROM v.fecha)::int            AS mes,
      SUM(COALESCE(v."importeManual", v.importe)) AS total
    FROM ventas v
    WHERE ${where}
    GROUP BY 1
  `);
  const out: Record<number, number> = {};
  for (const r of rows) out[r.mes] = toNumber(r.total ?? 0);
  return out;
}

// Disponible en caja por mes — reusa la agregación pura de precedencia local/PDV.
async function disponiblePorMes(
  anio: number,
  localId: number | undefined,
  puntoDeVentaId: number | undefined,
): Promise<Record<number, number | null>> {
  const rows = await prisma.flujoCajaManual.findMany({
    where: {
      anio,
      monto: { not: 0 },
      ...(localId !== undefined ? { localId } : {}),
      ...(puntoDeVentaId !== undefined ? { puntoDeVentaId } : {}),
    },
    select: { localId: true, puntoDeVentaId: true, mes: true, monto: true },
  });
  return aggregateFlujoCajaPorMes(
    rows.map((r) => ({
      localId: r.localId,
      puntoDeVentaId: r.puntoDeVentaId,
      mes: r.mes,
      monto: Number(r.monto),
    })),
    puntoDeVentaId,
  );
}

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    year: searchParams.get("year") ?? undefined,
    localId: searchParams.get("localId") ?? undefined,
    puntoDeVentaId: searchParams.get("puntoDeVentaId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }
  const { year, localId, puntoDeVentaId } = parsed.data;

  // Guarda de fan-out: cada año en [primerArqueo.anio .. year] cuesta 4 queries concurrentes
  // (Promise.all: sumVentasPorMes + 2× sumComprasPorMes + disponiblePorMes). Un `year` sin acotar
  // (ej. un `?year=20255` tipeado mal) expandiría el rango a miles de años × 4 queries y agotaría
  // el pool de Prisma. Fuera de rango → misma forma que el path sin arqueo (200 con los 12 meses
  // en null), nunca 400 (spec §3.1). El piso 2000 es un límite bajo el cual no hay datos reales.
  if (year < 2000 || year > new Date().getFullYear() + 1) {
    return NextResponse.json({ diferenciaPorMes: diferenciaVacia() });
  }

  try {
    const primerArqueo = await findPrimerArqueo({ localId, puntoDeVentaId });

    if (primerArqueo == null || primerArqueo.anio > year) {
      return NextResponse.json({ diferenciaPorMes: diferenciaVacia() });
    }

    const anios: number[] = [];
    for (let a = primerArqueo.anio; a <= year; a++) anios.push(a);

    const totalesPorAnio: Record<number, TotalesAnio> = {};
    await Promise.all(
      anios.map(async (anio) => {
        const [ingresosPorMes, egresosPorMes, gananciaPorMes, disponible] = await Promise.all([
          sumVentasPorMes(anio, localId, puntoDeVentaId),
          sumComprasPorMes(anio, localId, puntoDeVentaId, "visibleEnDashboard"),
          sumComprasPorMes(anio, localId, puntoDeVentaId, "visibleEnResultados"),
          disponiblePorMes(anio, localId, puntoDeVentaId),
        ]);
        totalesPorAnio[anio] = {
          ingresosPorMes,
          egresosPorMes,
          gananciaPorMes,
          disponiblePorMes: disponible,
        };
      }),
    );

    const diferenciaPorMes = buildDiferenciaCajaSerie({ year, primerArqueo, totalesPorAnio });
    return NextResponse.json({ diferenciaPorMes });
  } catch (err) {
    console.error("[GET /api/dashboard/diferencia-caja]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
