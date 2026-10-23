-- Órdenes de pago entre PDV: se anulan (no se borran) y cada cambio queda en un historial.
ALTER TABLE "pagos_internos" ADD COLUMN IF NOT EXISTS "anuladoEn" TIMESTAMP(3);
ALTER TABLE "pagos_internos" ADD COLUMN IF NOT EXISTS "creadoPor" TEXT;

CREATE TABLE IF NOT EXISTS "eventos_pago_interno" (
    "id" SERIAL NOT NULL,
    "pagoId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "detalle" TEXT,
    "importe" DECIMAL(14,2),
    "usuario" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eventos_pago_interno_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "eventos_pago_interno_pagoId_idx" ON "eventos_pago_interno"("pagoId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eventos_pago_interno_pagoId_fkey') THEN
    ALTER TABLE "eventos_pago_interno" ADD CONSTRAINT "eventos_pago_interno_pagoId_fkey"
      FOREIGN KEY ("pagoId") REFERENCES "pagos_internos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
