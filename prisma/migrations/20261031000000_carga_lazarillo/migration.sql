-- Carga de facturas desde el Panel (Etapa 4): marca lo cargado en Lazarillo.
-- El import de MaxiRest (14 y 25) saltea esos comprobantes: gana Lazarillo y no se duplica.
ALTER TABLE "compras" ADD COLUMN "origen" TEXT;
ALTER TABLE "detalle_compras" ADD COLUMN "origen" TEXT;
CREATE INDEX "compras_origen_localId_comprobante_codigo_idx" ON "compras"("origen", "localId", "comprobante", "codigo");
CREATE INDEX "detalle_compras_origen_localId_comprobante_codPro_idx" ON "detalle_compras"("origen", "localId", "comprobante", "codPro");
