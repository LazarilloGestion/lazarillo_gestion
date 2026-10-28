import { Prisma } from "@prisma/client";

// SERVIDOR. Cruce ARCA × compras (Diego 28/10/2026). En el Panel el comprobante termina en
// punto de venta (4) + número (8), con prefijos varios ("FCA", "A", "Z", "NC"…); el proveedor
// se reconoce por CUIT. Los internos ("E…", "G…") no son de ARCA.

/** Compras con número de ARCA, agrupadas por proveedor + comprobante + local. */
const comprasSql = Prisma.sql`
  SELECT regexp_replace(COALESCE(pr.cuit, ''), '\\D', '', 'g') AS cuit,
         CAST(SUBSTRING(c.comprobante FROM LENGTH(c.comprobante) - 11 FOR 4) AS int) AS pv,
         CAST(RIGHT(c.comprobante, 8) AS bigint) AS nro,
         c.comprobante, c."localId" AS local_id,
         to_char(MIN(COALESCE(c."fechaManual", c.fecha)), 'YYYY-MM-DD') AS fecha,
         SUM(COALESCE(c."importeManual", c.importe))::float8 AS total,
         MIN(c."rowId") AS row_id
  FROM compras c
  JOIN proveedores pr ON pr.id = c."proveedorId"
  WHERE c.comprobante ~ '[0-9]{12}$' AND UPPER(LEFT(c.comprobante, 1)) NOT IN ('E', 'G')
    AND COALESCE(pr.cuit, '') <> ''
  GROUP BY 1, 2, 3, 4, 5`;

export interface FilaArca {
  cuit: string; emisor: string | null; tipo: number; pv: number; nro: string; fecha: string;
  total: number; otros: number; neto: number; iva: number; no_gravado: number; exento: number;
  proveedor_id: number | null; proveedor: string | null;
  cargados: { comprobante: string; localId: number; total: number; fecha: string; rowId: string }[] | null;
}
export interface FilaSinPar { cuit: string; comprobante: string; local_id: number; total: number; fecha: string; row_id: string }

/** Cada comprobante de ARCA con lo cargado con su mismo CUIT + punto de venta + número. */
export const arcaSql = Prisma.sql`
  WITH g AS (${comprasSql}),
  prov AS (
    SELECT regexp_replace(cuit, '\\D', '', 'g') AS cuit, MIN(id) AS id,
           (array_agg(COALESCE(nombre, razon) ORDER BY id))[1] AS nombre
    FROM proveedores WHERE COALESCE(cuit, '') <> '' GROUP BY 1)
  SELECT a."cuitEmisor" AS cuit, a.emisor, a.tipo, a."puntoVenta" AS pv, a.numero::text AS nro,
         to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.total::float8 AS total, a."otrosTributos"::float8 AS otros,
         a.neto::float8 AS neto, a.iva::float8 AS iva, a."noGravado"::float8 AS no_gravado, a.exento::float8 AS exento,
         p.id AS proveedor_id, p.nombre AS proveedor,
         json_agg(json_build_object('comprobante', g.comprobante, 'localId', g.local_id, 'total', g.total,
                                    'fecha', g.fecha, 'rowId', g.row_id)) FILTER (WHERE g.row_id IS NOT NULL) AS cargados
  FROM arca_comprobantes a
  LEFT JOIN prov p ON p.cuit = a."cuitEmisor"
  LEFT JOIN g ON g.cuit = a."cuitEmisor" AND g.pv = a."puntoVenta" AND g.nro = a.numero
  GROUP BY a.id, p.id, p.nombre
  ORDER BY a.fecha DESC, a.id`;

/** Compras de proveedores que están en ARCA, sin comprobante de ARCA que coincida (para "cargada con otro número"). */
export const sinParSql = Prisma.sql`
  WITH g AS (${comprasSql}),
  r AS (SELECT MIN(fecha) - 20 AS desde, MAX(fecha) + 20 AS hasta FROM arca_comprobantes)
  SELECT g.cuit, g.comprobante, g.local_id, g.total, g.fecha, g.row_id
  FROM g, r
  WHERE g.fecha::date BETWEEN r.desde AND r.hasta
    AND EXISTS (SELECT 1 FROM arca_comprobantes a WHERE a."cuitEmisor" = g.cuit)
    AND NOT EXISTS (SELECT 1 FROM arca_comprobantes a WHERE a."cuitEmisor" = g.cuit AND a."puntoVenta" = g.pv AND a.numero = g.nro)`;
