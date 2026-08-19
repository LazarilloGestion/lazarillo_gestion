-- Vista centralizada de lectura para Apertura de Gastos (Fase B). Compras sin
-- distribuir se ven igual que hoy; compras distribuidas aparecen como N filas
-- (una por destino de la regla que las cubre), con local/puntoDeVenta e
-- importe del destino en vez de la compra original. Mismas columnas que
-- "compras" para que buildPivotConditions (lib/dashboard/query-builders.ts)
-- no cambie de forma — ver docs/superpowers/specs/2026-08-19-apertura-gastos-design.md
-- sección 4.
CREATE VIEW v_compras_distribuidas AS
SELECT
  c."rowId",
  NULL::integer            AS "distribucionId",
  c."localId",
  c."puntoDeVentaId",
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
