-- Migración de reparación de historial. `importeManual`, `fechaManual` y
-- `conceptoCodigoManual` ya existen en producción (agregadas fuera del
-- historial de migraciones versionado, probablemente vía `prisma db push`
-- antes de esta migración) — este archivo solo documenta esa realidad para
-- que el historial se pueda reconstruir desde cero (`prisma migrate dev`
-- necesita reproducirlo en su shadow database). No cambia nada en una base
-- que ya las tiene; en una base nueva, las crea igual que en producción.
-- Mismo patrón que 20260608000000_add_observac_manual_compras.
ALTER TABLE "compras" ADD COLUMN IF NOT EXISTS "importeManual" DECIMAL(65,30);
ALTER TABLE "compras" ADD COLUMN IF NOT EXISTS "fechaManual" TIMESTAMP(3);
ALTER TABLE "compras" ADD COLUMN IF NOT EXISTS "conceptoCodigoManual" TEXT;
