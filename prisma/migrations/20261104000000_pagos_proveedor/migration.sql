-- Pagos a proveedores cargados en Lazarillo (Etapa 4, 27/10/2026). El pago cuelga de
-- la factura entera (PDV + comprobante + código de proveedor, igual que el informe 80);
-- lo que no se imputa queda a cuenta del proveedor. Anular no borra: queda en el historial.
-- CreateTable
CREATE TABLE "pagos_proveedor" (
    "id" SERIAL NOT NULL,
    "codPro" TEXT NOT NULL,
    "pdvPagaId" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,
    "medio" TEXT NOT NULL,
    "referencia" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPor" TEXT,
    "anuladoEn" TIMESTAMP(3),
    "anuladoPor" TEXT,

    CONSTRAINT "pagos_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aplicaciones_pago_proveedor" (
    "id" SERIAL NOT NULL,
    "pagoId" INTEGER NOT NULL,
    "pdvId" INTEGER NOT NULL,
    "comprobante" TEXT NOT NULL,
    "codPro" TEXT NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "aplicaciones_pago_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_pago_proveedor" (
    "id" SERIAL NOT NULL,
    "pagoId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "detalle" TEXT,
    "importe" DECIMAL(14,2),
    "usuario" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_pago_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pagos_proveedor_codPro_idx" ON "pagos_proveedor"("codPro");
CREATE INDEX "aplicaciones_pago_proveedor_pagoId_idx" ON "aplicaciones_pago_proveedor"("pagoId");
CREATE INDEX "aplicaciones_pago_proveedor_pdvId_comprobante_codPro_idx" ON "aplicaciones_pago_proveedor"("pdvId", "comprobante", "codPro");
CREATE INDEX "eventos_pago_proveedor_pagoId_idx" ON "eventos_pago_proveedor"("pagoId");

-- AddForeignKey
ALTER TABLE "aplicaciones_pago_proveedor" ADD CONSTRAINT "aplicaciones_pago_proveedor_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "pagos_proveedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "eventos_pago_proveedor" ADD CONSTRAINT "eventos_pago_proveedor_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "pagos_proveedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
