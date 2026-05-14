-- Rename naTot → ivaTot (refleja el origen real: columna IVATOT del ERP)
ALTER TABLE detalle_compras RENAME COLUMN "naTot" TO "ivaTot";

-- Índice parcial para acelerar el JOIN de vinculación compraId
-- (solo filas aún no vinculadas, evita full scan en tablas grandes)
CREATE INDEX IF NOT EXISTS detalle_compras_unlinked_idx
  ON detalle_compras(comprobante)
  WHERE "compraId" IS NULL;
