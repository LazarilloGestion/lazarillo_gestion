ALTER TABLE "detalle_compras" ADD COLUMN IF NOT EXISTS "localId" INTEGER;

-- Backfill filas ya vinculadas a una compra
UPDATE detalle_compras dc
SET "localId" = c."localId"
FROM compras c
WHERE dc."compraId" = c."rowId"
  AND dc."localId" IS NULL;

CREATE INDEX IF NOT EXISTS "detalle_compras_localId_idx" ON "detalle_compras"("localId");

ALTER TABLE "detalle_compras"
  ADD CONSTRAINT "detalle_compras_localId_fkey"
  FOREIGN KEY ("localId") REFERENCES "locales"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
