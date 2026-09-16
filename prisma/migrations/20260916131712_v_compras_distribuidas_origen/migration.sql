-- Fix: el tooltip de composición del pivot (apertura-composicion.ts) arma su
-- query SIN el filtro de localId/pdvId del dashboard a propósito (ver
-- comentario en app/api/dashboard/pivot/route.ts) para mostrar el reparto
-- COMPLETO de una compra distribuida, aunque el destino caiga fuera del
-- local/PDV que se está mirando. Pero al tirar ese filtro por completo, la
-- composición quedaba agrupada solo por concepto_codigo + mes, sin ningún
-- scoping por negocio de origen — y como concepto_codigo puede colisionar
-- entre negocios (ver docs de Alta Nuñez-Comercio), el tooltip terminaba
-- sumando compras de OTRO negocio que comparten el mismo código de concepto.
--
-- La vista pisaba localId/puntoDeVentaId con el DESTINO de la regla para las
-- filas distribuidas, perdiendo el local/PDV real donde se cargó la compra.
-- Se agregan "localIdOrigen"/"puntoDeVentaIdOrigen" para poder filtrar la
-- composición por el negocio de origen sin filtrar por destino.
DROP VIEW v_compras_distribuidas;

CREATE VIEW v_compras_distribuidas AS
SELECT
  c."rowId",
  NULL::integer            AS "distribucionId",
  c."localId",
  c."puntoDeVentaId",
  c."localId"               AS "localIdOrigen",
  c."puntoDeVentaId"         AS "puntoDeVentaIdOrigen",
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
  c."proveedorId"
FROM compras c
WHERE c."esDistribuido" = false

UNION ALL

SELECT
  c."rowId",
  d.id                      AS "distribucionId",
  dr."localId",
  dr."puntoDeVentaId",
  c."localId"               AS "localIdOrigen",
  c."puntoDeVentaId"         AS "puntoDeVentaIdOrigen",
  d."importeCalculado"      AS importe,
  NULL::numeric             AS "importeManual",
  c.fecha,
  c."fechaManual",
  c."conceptoCodigo",
  c."conceptoCodigoManual",
  c.concepto,
  c.detalle,
  c.observac,
  c."observacManual",
  c.proveedor,
  c."proveedorId"
FROM distribuciones_apertura d
JOIN compras c        ON c."rowId" = d."compraRowId"
JOIN destinos_regla dr ON dr.id    = d."destinoId"
WHERE c."esDistribuido" = true;
