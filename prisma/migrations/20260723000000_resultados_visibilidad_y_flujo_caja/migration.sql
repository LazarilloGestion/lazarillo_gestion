-- AlterTable
ALTER TABLE "rubros_concepto_caja" ADD COLUMN IF NOT EXISTS "visibleEnResultados" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "flujo_caja_manual" (
    "id" SERIAL NOT NULL,
    "localId" INTEGER,
    "puntoDeVentaId" INTEGER,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "monto" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "flujo_caja_manual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flujo_caja_manual_localId_puntoDeVentaId_anio_mes_key" ON "flujo_caja_manual"("localId", "puntoDeVentaId", "anio", "mes");

-- AddForeignKey
ALTER TABLE "flujo_caja_manual" ADD CONSTRAINT "flujo_caja_manual_localId_fkey" FOREIGN KEY ("localId") REFERENCES "locales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujo_caja_manual" ADD CONSTRAINT "flujo_caja_manual_puntoDeVentaId_fkey" FOREIGN KEY ("puntoDeVentaId") REFERENCES "puntos_de_venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
