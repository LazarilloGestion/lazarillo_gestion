import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { mesesHasta, type Componente } from "@/lib/dashboard/canasta";

export const dynamic = "force-dynamic";

// Rubros estándar de MaxiRest (mismos códigos en Ramos y Comercio).
const RUBRO = { mercaderias: "1", servicios: "2", personal: "3", alquiler: "21" } as const;
const N = 13; // 12 variaciones: hacen falta 13 meses

// GET ?anio&mes(&localId&pdvId) — Canasta (inflación propia) de los 12 meses que terminan en anio/mes
// (el último mes cerrado), con aperturas aplicadas (v_compras_distribuidas). Ver lib/dashboard/canasta.ts.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const n = (k: string) => { const v = Number(sp.get(k)); return Number.isInteger(v) && v > 0 ? v : undefined; };
  const anio = n("anio"), mes = n("mes"), localId = n("localId"), pdvId = n("pdvId");
  if (!anio || !mes || mes > 12) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const meses = mesesHasta(anio, mes, N);
  const desde = `${meses[0]}-01`;
  const finRef = new Date(Date.UTC(anio, mes, 1)).toISOString().slice(0, 10);
  const desdePeso = `${meses[N - 6]}-01`;
  const fecha = Prisma.sql`COALESCE(v."fechaManual", v.periodo, v.fecha)`;
  const imp = Prisma.sql`COALESCE(v."importeManual", v.importe)`;
  const lugar = pdvId ? Prisma.sql`v."puntoDeVentaId" = ${pdvId}` : localId ? Prisma.sql`v."localId" = ${localId}` : Prisma.sql`TRUE`;
  const rango = Prisma.sql`${fecha} >= ${desde}::timestamp AND ${fecha} < ${finRef}::timestamp`;
  const concepto = Prisma.sql`cc.codigo = COALESCE(v."conceptoCodigoManual", v."conceptoCodigo")`;
  const mesDe = (e: Prisma.Sql) => Prisma.sql`to_char(date_trunc('month', ${e}), 'YYYY-MM')`;
  const anterior = (a: string) => Prisma.sql`to_char(to_date(${Prisma.raw(a)}, 'YYYY-MM') - interval '1 month', 'YYYY-MM')`;

  try {
    const [merc, sue, serv, alq, pesos, aumentos] = await Promise.all([
      // Mercaderías: Laspeyres por insumo (cantidades del mes anterior), saltos raros aparte.
      prisma.$queryRaw<{ m: string; v: number | null; revisar: number }[]>(Prisma.sql`
        WITH comp AS (SELECT DISTINCT v."rowId" FROM v_compras_distribuidas v WHERE ${lugar} AND ${rango}),
        l AS (
          SELECT ${mesDe(Prisma.sql`d.fecha`)} AS m, d.codigo || '|' || COALESCE(UPPER(TRIM(d.medida)), '') AS k,
                 SUM(d.cantidad) AS q, SUM(d.neto) AS val
          FROM detalle_compras d
          JOIN compras c ON c."rowId" = d."compraId"
          JOIN comp ON comp."rowId" = c."rowId"
          JOIN conceptos_caja cc ON cc.codigo = COALESCE(d."codCga", c."conceptoCodigoManual", c."conceptoCodigo")
          WHERE cc."codRga" = ${RUBRO.mercaderias} AND d.fecha >= ${desde}::timestamp AND d.fecha < ${finRef}::timestamp
            AND d.cantidad > 0 AND d.neto > 0 AND d.codigo IS NOT NULL
          GROUP BY 1, 2),
        p AS (SELECT m, k, q, val / q AS pr FROM l),
        par AS (SELECT a.m, a.pr AS pa, b.pr AS pb, b.q AS qb, (a.pr / b.pr BETWEEN 0.667 AND 1.5) AS ok
                FROM p a JOIN p b ON b.k = a.k AND b.m = ${anterior("a.m")})
        SELECT m, (SUM(qb * pa) FILTER (WHERE ok) / NULLIF(SUM(qb * pb) FILTER (WHERE ok), 0) - 1)::float8 AS v,
               (COUNT(*) FILTER (WHERE NOT ok))::int AS revisar
        FROM par GROUP BY m`),
      // Sueldos: mediana de la variación del mismo empleado (liquidación de sueldo + presentismo).
      prisma.$queryRaw<{ m: string; v: number | null }[]>(Prisma.sql`
        WITH e AS (
          SELECT ${mesDe(fecha)} AS m, v.codigo AS emp, SUM(${imp}) AS s
          FROM v_compras_distribuidas v
          JOIN conceptos_caja cc ON ${concepto}
          JOIN empleados em ON em.codigo = v.codigo AND em."puntoDeVentaId" = v."puntoDeVentaIdOrigen"
          WHERE ${lugar} AND ${rango} AND cc."codRga" = ${RUBRO.personal}
            AND cc.nombre ~* '(liquidaci.*sueldo|presentismo)' AND cc.nombre !~* '(sac|final)'
          GROUP BY 1, 2 HAVING SUM(${imp}) > 0)
        SELECT a.m, (exp(percentile_cont(0.5) WITHIN GROUP (ORDER BY ln(a.s / b.s))) - 1)::float8 AS v
        FROM e a JOIN e b ON b.emp = a.emp AND b.m = ${anterior("a.m")}
        WHERE a.s / b.s BETWEEN 0.5 AND 2 GROUP BY a.m HAVING COUNT(*) >= 3`),
      // Servicios: mediana de la variación de cada proveedor × concepto.
      prisma.$queryRaw<{ m: string; v: number | null }[]>(Prisma.sql`
        WITH s AS (
          SELECT ${mesDe(fecha)} AS m, COALESCE(v.codigo, '') || '|' || cc.codigo AS k, SUM(${imp}) AS val
          FROM v_compras_distribuidas v JOIN conceptos_caja cc ON ${concepto}
          WHERE ${lugar} AND ${rango} AND cc."codRga" = ${RUBRO.servicios}
          GROUP BY 1, 2 HAVING SUM(${imp}) > 0)
        SELECT a.m, (exp(percentile_cont(0.5) WITHIN GROUP (ORDER BY ln(a.val / b.val))) - 1)::float8 AS v
        FROM s a JOIN s b ON b.k = a.k AND b.m = ${anterior("a.m")}
        WHERE a.val / b.val BETWEEN 0.667 AND 1.5 GROUP BY a.m HAVING COUNT(*) >= 2`),
      // Alquiler: el monto del mes (en revisión: se muestra, no entra a la canasta).
      prisma.$queryRaw<{ m: string; total: number }[]>(Prisma.sql`
        SELECT ${mesDe(fecha)} AS m, SUM(${imp})::float8 AS total
        FROM v_compras_distribuidas v JOIN conceptos_caja cc ON ${concepto}
        WHERE ${lugar} AND ${rango} AND cc."codRga" = ${RUBRO.alquiler}
        GROUP BY 1`),
      // Pesos: gasto de cada rubro en los últimos 6 meses.
      prisma.$queryRaw<{ r: string; total: number }[]>(Prisma.sql`
        SELECT cc."codRga" AS r, SUM(${imp})::float8 AS total
        FROM v_compras_distribuidas v JOIN conceptos_caja cc ON ${concepto}
        WHERE ${lugar} AND ${fecha} >= ${desdePeso}::timestamp AND ${fecha} < ${finRef}::timestamp
          AND cc."codRga" IN (${RUBRO.mercaderias}, ${RUBRO.servicios}, ${RUBRO.personal}, ${RUBRO.alquiler})
        GROUP BY 1`),
      pdvId
        ? prisma.$queryRaw<{ fecha: string; origen: string; pct: number | null; provisorio: boolean }[]>`
            SELECT fecha::text AS fecha, origen, pct::float8 AS pct, provisorio FROM aumentos_precio
            WHERE "puntoDeVentaId" = ${pdvId} AND NOT descartado ORDER BY fecha`
        : Promise.resolve([]),
    ]);

    const serie = (filas: { m: string; v: number | null }[]) => {
      const map = new Map(filas.map((f) => [f.m, f.v == null ? null : Number(f.v)]));
      return meses.slice(1).map((m) => map.get(m) ?? null);
    };
    const alqMap = new Map(alq.map((a) => [a.m, Number(a.total)]));
    const alqVar = meses.slice(1).map((m, i) => {
      const a = alqMap.get(m), b = alqMap.get(meses[i]);
      return a != null && b != null && b > 0 ? a / b - 1 : null;
    });
    const peso = (r: string) => Number(pesos.find((p) => p.r === r)?.total ?? 0);
    const componentes: Componente[] = [
      { clave: "sueldos", nombre: "Sueldos", peso: peso(RUBRO.personal), variaciones: serie(sue), cuenta: true },
      { clave: "mercaderias", nombre: "Mercaderías", peso: peso(RUBRO.mercaderias), variaciones: serie(merc), cuenta: true,
        aRevisar: merc.find((x) => x.m === meses[N - 1])?.revisar ?? 0 },
      { clave: "servicios", nombre: "Servicios", peso: peso(RUBRO.servicios), variaciones: serie(serv), cuenta: true },
      { clave: "alquiler", nombre: "Alquiler", peso: peso(RUBRO.alquiler), variaciones: alqVar, cuenta: false },
    ].filter((c) => c.peso > 0) as Componente[];

    return NextResponse.json({ meses: meses.slice(1), componentes, aumentos });
  } catch (err) {
    console.error("[GET /api/dashboard/canasta]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
