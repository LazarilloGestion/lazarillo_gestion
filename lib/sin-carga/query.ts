import { Prisma } from "@prisma/client";
import { sinRubroVisibleSql } from "@/lib/dashboard/query-builders";
import { GV_CODIGO } from "@/lib/gastos-varios/periodo";
import { RECURRENTE_MIN, RECURRENTE_VENTANA } from "./estado";

// SERVIDOR. Gastos recurrentes que faltan en cada mes objetivo (ver lib/sin-carga/estado.ts).
// Se mira lo cargado EN el PDV (origen), por fecha económica (fecha manual, período o fecha).
// Clave: el proveedor; sin proveedor (o con "Gastos Varios" de Lazarillo), el concepto de caja.

export interface FilaSinCarga {
  mes: string; clave: string; proveedor: string | null; proveedor_id: number | null;
  concepto: string | null; concepto_codigo: string | null; rubro: string | null;
  ultimo: number; dia: number; vencido: boolean;
}

export function sinCargaSql(pdvId: number, meses: string[]): Prisma.Sql {
  const desde = meses[meses.length - 1];
  const hasta = meses[0];
  const fechaEco = Prisma.sql`COALESCE(c."fechaManual", c.periodo, c.fecha)`;
  return Prisma.sql`
    WITH b AS (
      SELECT date_trunc('month', ${fechaEco})::date AS mes,
             EXTRACT(day FROM COALESCE(c."fechaManual", c.fecha))::int AS dia,
             (c.periodo IS NOT NULL) AS vencido,
             CASE WHEN c."proveedorId" IS NOT NULL AND pr.codigo <> ${GV_CODIGO} THEN 'p:' || c."proveedorId"
                  ELSE 'c:' || COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") END AS clave,
             CASE WHEN pr.codigo <> ${GV_CODIGO} THEN c."proveedorId" END AS proveedor_id,
             CASE WHEN pr.codigo <> ${GV_CODIGO} THEN COALESCE(pr.nombre, pr.razon) END AS proveedor,
             COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") AS concepto_codigo,
             TRIM(COALESCE(cc.nombre, c.concepto)) AS concepto,
             TRIM(rc.nombre) AS rubro,
             COALESCE(c."importeManual", c.importe) AS imp
      FROM compras c
      LEFT JOIN proveedores pr          ON pr.id = c."proveedorId"
      LEFT JOIN conceptos_caja cc       ON cc.codigo = COALESCE(c."conceptoCodigoManual", c."conceptoCodigo")
      LEFT JOIN rubros_concepto_caja rc ON rc.codigo = cc."codRga"
      WHERE c."puntoDeVentaId" = ${pdvId}
        AND ${fechaEco} >= (${desde}::date - make_interval(months => ${RECURRENTE_VENTANA}))
        AND ${fechaEco} <  (${hasta}::date + interval '1 month')
        AND (rc."visibleEnDashboard" = true OR (rc.codigo IS NULL AND ${sinRubroVisibleSql("visibleEnDashboard")}))
        AND (c."proveedorId" IS NOT NULL OR COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") IS NOT NULL)
    ),
    pm AS (
      SELECT clave, mes, SUM(imp) AS imp, AVG(dia) AS dia, BOOL_OR(vencido) AS vencido,
             MIN(proveedor_id) AS proveedor_id, MIN(proveedor) AS proveedor,
             (array_agg(concepto ORDER BY imp DESC))[1] AS concepto,
             (array_agg(concepto_codigo ORDER BY imp DESC))[1] AS concepto_codigo,
             (array_agg(rubro ORDER BY imp DESC))[1] AS rubro
      FROM b GROUP BY clave, mes
    ),
    obj AS (SELECT unnest(${meses}::date[]) AS m),
    r AS (
      SELECT o.m, x.clave, COUNT(*) AS n,
             (array_agg(x.imp ORDER BY x.mes DESC))[1] AS ultimo,
             (array_agg(x.proveedor ORDER BY x.mes DESC))[1] AS proveedor,
             (array_agg(x.proveedor_id ORDER BY x.mes DESC))[1] AS proveedor_id,
             (array_agg(x.concepto ORDER BY x.mes DESC))[1] AS concepto,
             (array_agg(x.concepto_codigo ORDER BY x.mes DESC))[1] AS concepto_codigo,
             (array_agg(x.rubro ORDER BY x.mes DESC))[1] AS rubro,
             AVG(x.dia) AS dia, BOOL_OR(x.vencido) AS vencido
      FROM obj o
      JOIN pm x ON x.mes < o.m AND x.mes >= o.m - make_interval(months => ${RECURRENTE_VENTANA})
      GROUP BY o.m, x.clave
      HAVING COUNT(*) >= ${RECURRENTE_MIN}
    )
    SELECT to_char(r.m, 'YYYY-MM') AS mes, r.clave, r.proveedor, r.proveedor_id::int AS proveedor_id,
           r.concepto, r.concepto_codigo, r.rubro, ROUND(r.ultimo, 2)::float8 AS ultimo,
           ROUND(r.dia)::int AS dia, r.vencido
    FROM r
    WHERE r.ultimo > 0
      AND NOT EXISTS (SELECT 1 FROM pm WHERE pm.clave = r.clave AND pm.mes = r.m)
      AND NOT EXISTS (SELECT 1 FROM sin_carga_descartes d WHERE d."pdvId" = ${pdvId} AND d.clave = r.clave)
    ORDER BY r.m DESC, r.ultimo DESC
  `;
}
