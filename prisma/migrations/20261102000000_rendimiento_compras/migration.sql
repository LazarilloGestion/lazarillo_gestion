-- Rendimiento del panel (revisión 27/10/2026).
-- 1) La vista expone periodo, comprobante y fechaPago: la fuente Económica / Financiera
--    deja de volver a juntar la vista con compras (un recorrido completo menos por consulta).
CREATE OR REPLACE VIEW v_compras_distribuidas AS
 SELECT c."rowId",
    NULL::integer AS "distribucionId",
    c."localId",
    c."puntoDeVentaId",
    c."localId" AS "localIdOrigen",
    c."puntoDeVentaId" AS "puntoDeVentaIdOrigen",
    c.importe,
    c."importeManual",
    c.fecha,
    c."fechaManual",
    c."conceptoCodigo",
    c."conceptoCodigoManual",
    c.concepto,
    c.detalle,
    c.observac,
    c."observacManual",
    c.proveedor,
    c."proveedorId",
    c.codigo,
    c.periodo,
    c.comprobante,
    c."fechaPago"
   FROM compras c
  WHERE c."esDistribuido" = false
UNION ALL
 SELECT c."rowId",
    d.id AS "distribucionId",
    dr."localId",
    dr."puntoDeVentaId",
    c."localId" AS "localIdOrigen",
    c."puntoDeVentaId" AS "puntoDeVentaIdOrigen",
    d."importeCalculado" AS importe,
    NULL::numeric AS "importeManual",
    c.fecha,
    c."fechaManual",
    c."conceptoCodigo",
    c."conceptoCodigoManual",
    c.concepto,
    c.detalle,
    c.observac,
    c."observacManual",
    c.proveedor,
    c."proveedorId",
    c.codigo,
    c.periodo,
    c.comprobante,
    c."fechaPago"
   FROM distribuciones_apertura d
     JOIN compras c ON c."rowId" = d."compraRowId"
     JOIN destinos_regla dr ON dr.id = d."destinoId"
  WHERE c."esDistribuido" = true;

-- 2) Índices para cruzar facturas con sus pagos (Financiera, impagas, cta cte) y para
--    "la última factura del proveedor" (Repetir).
CREATE INDEX IF NOT EXISTS "pagos_puntoDeVentaId_comprobante_codPro_idx" ON "pagos"("puntoDeVentaId", "comprobante", "codPro");
CREATE INDEX IF NOT EXISTS "compras_puntoDeVentaId_comprobante_codigo_idx" ON "compras"("puntoDeVentaId", "comprobante", "codigo");
CREATE INDEX IF NOT EXISTS "compras_proveedorId_localId_idx" ON "compras"("proveedorId", "localId");
