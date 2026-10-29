-- Conceptos de caja de MaxiRest editables en Lazarillo (Diego 29/10/2026): el original de
-- MaxiRest queda en *Maxirest; nombre / tipo / codRga son los que usa el Panel.
ALTER TABLE "conceptos_caja" ADD COLUMN IF NOT EXISTS "nombreMaxirest" TEXT;
ALTER TABLE "conceptos_caja" ADD COLUMN IF NOT EXISTS "tipoMaxirest" TEXT;
ALTER TABLE "conceptos_caja" ADD COLUMN IF NOT EXISTS "codRgaMaxirest" TEXT;
ALTER TABLE "conceptos_caja" ADD COLUMN IF NOT EXISTS "editadoEnLazarillo" BOOLEAN NOT NULL DEFAULT false;
UPDATE "conceptos_caja" SET "nombreMaxirest" = nombre, "tipoMaxirest" = tipo, "codRgaMaxirest" = "codRga"
WHERE "nombreMaxirest" IS NULL AND NOT (codigo ~ '^[0-9]+$' AND codigo::bigint >= 1000);
