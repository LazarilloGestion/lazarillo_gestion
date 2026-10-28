import { Prisma } from "@prisma/client";
import { sinRubroVisibleSql } from "@/lib/dashboard/query-builders";
import { GV_CODIGO } from "@/lib/gastos-varios/periodo";
import { RECURRENTE_MIN, RECURRENTE_VENTANA } from "./estado";

// SERVIDOR. Gastos recurrentes que faltan en cada mes objetivo (ver lib/sin-carga/estado.ts).
// Se mira lo que IMPACTA en el PDV, con las reglas de apertura aplicadas (Diego 28/10: "no me
// pongas alquiler en bar si no impacta ahí") — v_compras_distribuidas, por fecha económica.
// De cada gasto también sale dónde se carga (PDV de origen) y su importe entero, para "Cargar".
// Clave: el proveedor; sin proveedor (o con "Gastos Varios" de Lazarillo), el concepto de caja.

export interface FilaSinCarga {
  mes: string; clave: string; proveedor: string | null; proveedor_id: number | null;
  concepto: string | null; concepto_codigo: string | null; rubro: string | null;
  ultimo: number; dia: number; vencido: boolean;
  pdv_origen: number | null; ultimo_total: number;
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
             COALESCE(c."importeManual", c.importe) AS imp,
             c."rowId" AS row_id, c."puntoDeVentaIdOrigen" AS pdv_origen,
             COALESCE(o."importeManual", o.importe) AS imp_total
      FROM v_compras_distribuidas c
      JOIN compras o                    ON o."rowId" = c."rowId"
      LEFT JOIN proveedores pr          ON pr.id = c."proveedorId"
      LEFT JOIN conceptos_caja cc       ON cc.codigo = COALESCE(c."conceptoCodigoManual", c."conceptoCodigo")
      LEFT JOIN rubros_concepto_caja rc ON rc.codigo = cc."codRga"
      WHERE c."puntoDeVentaId" = ${pdvId}
        AND ${fechaEco} >= (${desde}::date - make_interval(months => ${RECURRENTE_VENTANA}))
        AND ${fechaEco} <  (${hasta}::date + interval '1 month')
        AND (rc."visibleEnDashboard" = true OR (rc.codigo IS NULL AND ${sinRubroVisibleSql("visibleEnDashboard")}))
        AND (c."proveedorId" IS NOT NULL OR COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") IS NOT NULL)
    ),
    tot AS (
      SELECT clave, mes, SUM(imp_total) AS imp_total, MODE() WITHIN GROUP (ORDER BY pdv_origen) AS pdv_origen
      FROM (SELECT DISTINCT clave, mes, row_id, imp_total, pdv_origen FROM b) d
      GROUP BY clave, mes
    ),
    pm0 AS (
      SELECT clave, mes, SUM(imp) AS imp, AVG(dia) AS dia, BOOL_OR(vencido) AS vencido,
             MIN(proveedor_id) AS proveedor_id, MIN(proveedor) AS proveedor,
             (array_agg(concepto ORDER BY imp DESC))[1] AS concepto,
             (array_agg(concepto_codigo ORDER BY imp DESC))[1] AS concepto_codigo,
             (array_agg(rubro ORDER BY imp DESC))[1] AS rubro
      FROM b GROUP BY clave, mes
    ),
    pm AS (SELECT pm0.*, tot.imp_total, tot.pdv_origen FROM pm0 JOIN tot USING (clave, mes)),
    obj AS (SELECT unnest(${meses}::date[]) AS m),
    r AS (
      SELECT o.m, x.clave, COUNT(*) AS n,
             (array_agg(x.imp ORDER BY x.mes DESC))[1] AS ultimo,
             (array_agg(x.proveedor ORDER BY x.mes DESC))[1] AS proveedor,
             (array_agg(x.proveedor_id ORDER BY x.mes DESC))[1] AS proveedor_id,
             (array_agg(x.concepto ORDER BY x.mes DESC))[1] AS concepto,
             (array_agg(x.concepto_codigo ORDER BY x.mes DESC))[1] AS concepto_codigo,
             (array_agg(x.rubro ORDER BY x.mes DESC))[1] AS rubro,
             AVG(x.dia) AS dia, BOOL_OR(x.vencido) AS vencido,
             (array_agg(x.imp_total ORDER BY x.mes DESC))[1] AS ultimo_total,
             (array_agg(x.pdv_origen ORDER BY x.mes DESC))[1] AS pdv_origen
      FROM obj o
      JOIN pm x ON x.mes < o.m AND x.mes >= o.m - make_interval(months => ${RECURRENTE_VENTANA})
      GROUP BY o.m, x.clave
      HAVING COUNT(*) >= ${RECURRENTE_MIN}
    )
    SELECT to_char(r.m, 'YYYY-MM') AS mes, r.clave, r.proveedor, r.proveedor_id::int AS proveedor_id,
           r.concepto, r.concepto_codigo, r.rubro, ROUND(r.ultimo, 2)::float8 AS ultimo,
           ROUND(r.dia)::int AS dia, r.vencido,
           r.pdv_origen::int AS pdv_origen, ROUND(r.ultimo_total, 2)::float8 AS ultimo_total
    FROM r
    WHERE r.ultimo > 0
      AND NOT EXISTS (SELECT 1 FROM pm WHERE pm.clave = r.clave AND pm.mes = r.m)
      -- "Ya no va": la clave sola; "Este mes no": la clave con "@YYYY-MM".
      AND NOT EXISTS (SELECT 1 FROM sin_carga_descartes d WHERE d."pdvId" = ${pdvId}
                        AND d.clave IN (r.clave, r.clave || '@' || to_char(r.m, 'YYYY-MM')))
    ORDER BY r.m DESC, r.ultimo DESC
  `;
}
