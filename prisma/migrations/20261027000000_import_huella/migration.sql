-- Huella del archivo de Drive en cada importación (fecha de modificación +
-- tamaño): si el mismo archivo no cambió desde la última importación OK, se
-- saltea sin descargarlo.
ALTER TABLE "import_logs" ADD COLUMN IF NOT EXISTS "driveFileId" TEXT;
ALTER TABLE "import_logs" ADD COLUMN IF NOT EXISTS "driveHuella" TEXT;
CREATE INDEX IF NOT EXISTS "import_logs_driveFileId_creadoEn_idx" ON "import_logs"("driveFileId", "creadoEn");
