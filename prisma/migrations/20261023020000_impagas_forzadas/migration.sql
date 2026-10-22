-- Vista Impagas: comprobantes pasados a mano a Impagas.
CREATE TABLE IF NOT EXISTS "impagas_forzadas" (
    "id" SERIAL NOT NULL,
    "puntoDeVentaId" INTEGER NOT NULL,
    "comprobante" TEXT NOT NULL,
    "codPro" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "impagas_forzadas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "impagas_forzadas_puntoDeVentaId_comprobante_codPro_key" ON "impagas_forzadas"("puntoDeVentaId", "comprobante", "codPro");
