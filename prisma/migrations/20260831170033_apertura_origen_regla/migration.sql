-- Origen (local/PDV) de la regla de apertura. Ver
-- docs/superpowers/specs/2026-08-31-apertura-fixes-origen-tooltip-reeval-design.md
--
-- Migración hecha a mano + `prisma migrate deploy` (el flujo `migrate dev` de
-- este repo está roto por P4002 / cross-schema FK a auth.users — ver memoria
-- project_import_logs_deuda_migraciones).
--
-- Ordenada con guardas idempotentes (IF [NOT] EXISTS): un primer intento aplicó
-- las columnas y las FK pero falló al agregar el CHECK sobre filas viejas sin
-- origen. Este orden borra primero las reglas viejas y recién después agrega el
-- CHECK, y es seguro de re-correr sobre el estado parcial.

-- Reglas viejas sin origen: se dan de baja (dev, sin backfill — no se guardó el
-- origen). La data de compras del ERP NO se toca — solo los flags de apertura,
-- que se resetean para que el motor vuelva a tomar las compras cuando se creen
-- las reglas nuevas con origen tras la próxima reimportación.
DELETE FROM "distribuciones_apertura";
DELETE FROM "destinos_regla";
DELETE FROM "reglas_apertura";
UPDATE "compras" SET "esDistribuido" = false, "distribuidoEn" = NULL WHERE "esDistribuido" = true;

ALTER TABLE "reglas_apertura" ADD COLUMN IF NOT EXISTS "origenLocalId" INTEGER;
ALTER TABLE "reglas_apertura" ADD COLUMN IF NOT EXISTS "origenPuntoDeVentaId" INTEGER;

ALTER TABLE "reglas_apertura" DROP CONSTRAINT IF EXISTS "reglas_apertura_origenLocalId_fkey";
ALTER TABLE "reglas_apertura"
  ADD CONSTRAINT "reglas_apertura_origenLocalId_fkey"
  FOREIGN KEY ("origenLocalId") REFERENCES "locales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reglas_apertura" DROP CONSTRAINT IF EXISTS "reglas_apertura_origenPuntoDeVentaId_fkey";
ALTER TABLE "reglas_apertura"
  ADD CONSTRAINT "reglas_apertura_origenPuntoDeVentaId_fkey"
  FOREIGN KEY ("origenPuntoDeVentaId") REFERENCES "puntos_de_venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reglas_apertura" DROP CONSTRAINT IF EXISTS "reglas_apertura_origen_no_nulo";
ALTER TABLE "reglas_apertura"
  ADD CONSTRAINT "reglas_apertura_origen_no_nulo"
  CHECK ("origenLocalId" IS NOT NULL OR "origenPuntoDeVentaId" IS NOT NULL);

DROP INDEX IF EXISTS "reglas_apertura_entidadId_nivel_idx";
CREATE INDEX IF NOT EXISTS "reglas_apertura_entidadId_nivel_origenLocalId_origenPuntoDeVentaId_idx"
  ON "reglas_apertura"("entidadId", "nivel", "origenLocalId", "origenPuntoDeVentaId");
