-- Expone Compra.codigo (columna D del Excel de compras, ya guardado tal cual
-- viene del ERP) en la vista que alimenta el dashboard — hoy no estaba
-- expuesto, así que el código de proveedor/empleado era invisible para
-- cualquier query que lea de acá. Ver docs/superpowers/specs/
-- 2026-09-28-codigo-empleado-proveedor-design.md §3.1.
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
  c."proveedorId",
  c.codigo
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
  c."proveedorId",
  c.codigo
FROM distribuciones_apertura d
JOIN compras c        ON c."rowId" = d."compraRowId"
JOIN destinos_regla dr ON dr.id    = d."destinoId"
WHERE c."esDistribuido" = true;
