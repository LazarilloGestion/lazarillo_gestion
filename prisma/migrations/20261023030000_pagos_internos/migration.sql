-- Pagos entre PDV por aperturas (vista Impagas).
CREATE TABLE IF NOT EXISTS "pagos_internos" (
    "id" SERIAL NOT NULL,
    "pdvOrigenId" INTEGER NOT NULL,
    "pdvDestinoId" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,
    "medio" TEXT NOT NULL,
    "referencia" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pagos_internos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "aplicaciones_pago_interno" (
    "id" SERIAL NOT NULL,
    "pagoId" INTEGER NOT NULL,
    "compraRowId" TEXT NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "aplicaciones_pago_interno_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pagos_internos_referencia_key" ON "pagos_internos"("referencia");
CREATE INDEX IF NOT EXISTS "pagos_internos_pdvDestinoId_pdvOrigenId_idx" ON "pagos_internos"("pdvDestinoId", "pdvOrigenId");
CREATE INDEX IF NOT EXISTS "aplicaciones_pago_interno_pagoId_idx" ON "aplicaciones_pago_interno"("pagoId");
CREATE INDEX IF NOT EXISTS "aplicaciones_pago_interno_compraRowId_idx" ON "aplicaciones_pago_interno"("compraRowId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aplicaciones_pago_interno_pagoId_fkey') THEN
    ALTER TABLE "aplicaciones_pago_interno" ADD CONSTRAINT "aplicaciones_pago_interno_pagoId_fkey"
      FOREIGN KEY ("pagoId") REFERENCES "pagos_internos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
